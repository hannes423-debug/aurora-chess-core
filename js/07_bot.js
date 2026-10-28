/* ======================================================
   BOT — Heuristic 1-ply engine
   Evaluates every legal move and picks the best one.
   withSimulatedMove() is used for all scoring — no board
   copies are made, nothing is permanently altered here.
====================================================== */

/* ── Piece values (tuned for 3D mobility) ── */
const BOT_VALUES = { pawn:1, knight:4, bishop:6, rook:7, queen:14, king:1000 };

function botGetPieceValue(p) {
  return BOT_VALUES[p.userData.type] || 0;
}

/* ── Manhattan-ish distance from 3D board centre ──
   XY centre = 3.5 (for 8×8). Z centre = (LAYERS-1)/2 = 1.5 for 4 layers.
   Returns Euclidean distance; used for centre-preference penalty.      */
function botDistFromCenter(x, y, z) {
  const dx=x-3.5, dy=y-3.5, dz=z-(LAYERS-1)/2;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

/* ── Smallest attacker value ──
   Finds the cheapest piece of `byColor` that attacks (x,y,z).
   Uses getPseudoMoves so it respects the current board state
   at the moment of the call (inside a withSimulatedMove scope). */
function botSmallestAttacker(x, y, z, byColor) {
  let smallest = Infinity;
  for (const p of pieces) {
    if (p.userData.color !== byColor) continue;
    const attacks = getPseudoMoves(p).some(m => m.x===x && m.y===y && m.z===z);
    if (attacks) {
      const v = botGetPieceValue(p);
      if (v < smallest) smallest = v;
    }
  }
  return smallest === Infinity ? 0 : smallest;
}

/* ── Pawn promotion distance for one pawn ──
   Returns how far a pawn is from its promotion rank.
   Promotion triggers only on the back rank: y=7 (white) or y=0 (black). */
function botPawnPromoDist(p) {
  if (p.userData.type !== 'pawn') return 0;
  const white = p.userData.color === 'white';
  return white ? (7 - p.userData.y) : p.userData.y;
}

/* ── Evaluate a position from `color`'s perspective ──
   Called while inside a withSimulatedMove callback so the
   board already reflects the proposed move.                      */
function botEvalPosition(color) {
  const opp = color === 'white' ? 'black' : 'white';
  let score = 0;

  for (const p of pieces) {
    const v   = botGetPieceValue(p);
    const own = p.userData.color === color;
    score += own ? v : -v;

    /* Centre preference — pieces near the centre are more active */
    const centreBonus = -botDistFromCenter(p.userData.x, p.userData.y, p.userData.z) * 0.05;
    score += own ? centreBonus : -centreBonus;

    /* Pawn promotion pressure */
    if (p.userData.type === 'pawn') {
      const closeness = (white => white ? 6 : 1)(p.userData.color === 'white') - botPawnPromoDist(p);
      // Higher is closer, weight it gently
      const promoBonus = closeness * 0.12;
      score += own ? promoBonus : -promoBonus;
    }
  }

  /* Mobility — number of legal moves available is an activity proxy.
     Iterate only bot's pieces for speed; opponent count is estimated
     by counting pseudo-moves (avoids re-calling getLegalMoves).     */
  let myMobility = 0, oppMobility = 0;
  for (const p of pieces) {
    const pm = getPseudoMoves(p).length;
    if (p.userData.color === color) myMobility  += pm;
    else                             oppMobility += pm;
  }
  score += (myMobility - oppMobility) * 0.05;

  return score;
}

/* ── Score one candidate move ──
   Runs entirely inside withSimulatedMove so the board is
   temporarily updated, evaluated, then atomically restored. */
function botScoreMove(piece, move) {
  const color  = piece.userData.color;
  const opp    = color === 'white' ? 'black' : 'white';
  const victim = occ(move.x, move.y, move.z);

  return withSimulatedMove(piece, move, () => {
    let score = botEvalPosition(color);

    /* ── Capture bonus / safety adjustment ── */
    if (victim) {
      const capVal      = botGetPieceValue(victim);
      const attacker    = botSmallestAttacker(move.x, move.y, move.z, opp);
      // Net exchange value: gain the captured piece, risk losing our piece
      score += capVal;
      if (attacker > 0) {
        // Only penalise if the attacker is cheaper than what we captured
        score -= Math.max(0, botGetPieceValue(piece) - capVal) * 0.5;
      }
    }

    /* ── Square safety ── */
    const smallestEnemy = botSmallestAttacker(move.x, move.y, move.z, opp);
    if (smallestEnemy > 0) {
      // Hanging penalty proportional to piece value vs smallest attacker
      const hanging = botGetPieceValue(piece) - smallestEnemy;
      if (hanging > 0) score -= hanging * 0.5;
    }

    /* ── Pawn promotion: immediate promotion to queen ── */
    if (piece.userData.type === 'pawn') {
      const white = color === 'white';
      if ((white && move.y === 7) || (!white && move.y === 0)) {
        score += BOT_VALUES.queen - BOT_VALUES.pawn;
      } else {
        // Reward pawn advancement toward promotion
        const before = botPawnPromoDist(piece);            // dist BEFORE move
        const after  = white ? (7 - move.y) : move.y;
        score += (before - after) * 0.5;                  // positive if closer
      }
    }

    /* ── Destination centre preference ── */
    score -= botDistFromCenter(move.x, move.y, move.z) * 0.05;

    /* ── Mobility at destination (pieces freed / added) ── */
    score += getPseudoMoves(piece).length * 0.05;

    return score;
  });
}

/* ── Transposition table — cleared at the start of each bot search ── */
const _botTT = new Map();

/* ── Minimax with alpha-beta pruning + transposition table (Hard/Max mode) ── */
function botMinimax(depth, alpha, beta, maximizing) {
  const color = maximizing ? botColor : (botColor==='white'?'black':'white');
  if (depth === 0) return botEvalPosition(botColor);

  // TT lookup: if we've already evaluated this exact position at this depth, reuse it
  const ttKey = getBoardHash() + (maximizing ? 'M' : 'O') + depth;
  if (_botTT.has(ttKey)) return _botTT.get(ttKey);

  const candidates = [];
  for (const p of pieces) {
    if (p.userData.color !== color) continue;
    for (const m of getLegalMoves(p)) candidates.push({piece:p,move:m});
  }
  if (!candidates.length) {
    if (isInCheck(color)) return maximizing ? -9999 : 9999;
    return 0; // stalemate
  }
  let best;
  if (maximizing) {
    best = -Infinity;
    for (const c of candidates) {
      const s = withSimulatedMove(c.piece, c.move, () => botMinimax(depth-1, alpha, beta, false));
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (beta <= alpha) break;
    }
  } else {
    best = Infinity;
    for (const c of candidates) {
      const s = withSimulatedMove(c.piece, c.move, () => botMinimax(depth-1, alpha, beta, true));
      if (s < best) best = s;
      if (s < beta) beta = s;
      if (beta <= alpha) break;
    }
  }
  _botTT.set(ttKey, best);
  return best;
}

/* ── Main bot entry point ── */
/* ── Source code for the bot Web Worker (runs off main thread) ── */
const BOT_WORKER_SRC = (function(){
  // All pure game-logic functions, constants — no DOM, no Three.js.
  // Piece objects are plain {userData:{type,color,x,y,z,moved}}.
  return `
'use strict';
const BOARD=8,LAYERS=4;
const BOT_VALUES={pawn:1,knight:4,bishop:6,rook:7,queen:14,king:1000};
let pieces=[],boardMap={},lastDoublePawn=null,botColor='white';
let holeSquares=new Set();
function key(x,y,z){return x+'_'+y+'_'+z;}
function occ(x,y,z){return boardMap[key(x,y,z)];}
function isHole(x,y,z){return holeSquares.has(key(x,y,z));}
function ray(lm,piece,dx,dy,dz){const{x,y,z}=piece.userData;for(let i=1;i<8;i++){const tx=x+dx*i,ty=y+dy*i,tz=z+dz*i;if(tx<0||tx>7||ty<0||ty>7||tz<0||tz>=LAYERS)break;if(isHole(tx,ty,tz))break;const t=occ(tx,ty,tz);if(!t){lm.push({x:tx,y:ty,z:tz});}else{if(t.userData.color!==piece.userData.color)lm.push({x:tx,y:ty,z:tz});break;}}}
function getKnightMoves(p){const moves=[],{x,y,z}=p.userData;[[2,1,0],[2,-1,0],[-2,1,0],[-2,-1,0],[2,0,1],[2,0,-1],[-2,0,1],[-2,0,-1],[1,2,0],[1,-2,0],[-1,2,0],[-1,-2,0],[0,2,1],[0,2,-1],[0,-2,1],[0,-2,-1],[1,0,2],[1,0,-2],[-1,0,2],[-1,0,-2],[0,1,2],[0,1,-2],[0,-1,2],[0,-1,-2]].forEach(function(d){const tx=x+d[0],ty=y+d[1],tz=z+d[2];if(tx<0||tx>7||ty<0||ty>7||tz<0||tz>=LAYERS)return;if(isHole(tx,ty,tz))return;const t=occ(tx,ty,tz);if(!t||t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z:tz});});return moves;}
function getRookMoves(p){const m=[];ray(m,p,1,0,0);ray(m,p,-1,0,0);ray(m,p,0,1,0);ray(m,p,0,-1,0);ray(m,p,0,0,1);ray(m,p,0,0,-1);return m;}
function getBishopMoves(p){const m=[];ray(m,p,1,1,0);ray(m,p,-1,1,0);ray(m,p,1,-1,0);ray(m,p,-1,-1,0);ray(m,p,1,1,1);ray(m,p,-1,1,1);ray(m,p,1,-1,1);ray(m,p,-1,-1,1);ray(m,p,1,1,-1);ray(m,p,-1,1,-1);ray(m,p,1,-1,-1);ray(m,p,-1,-1,-1);return m;}
function getQueenMoves(p){const m=[];ray(m,p,1,0,0);ray(m,p,-1,0,0);ray(m,p,0,1,0);ray(m,p,0,-1,0);ray(m,p,1,1,0);ray(m,p,-1,1,0);ray(m,p,1,-1,0);ray(m,p,-1,-1,0);ray(m,p,0,0,1);ray(m,p,0,0,-1);ray(m,p,1,0,1);ray(m,p,-1,0,1);ray(m,p,1,0,-1);ray(m,p,-1,0,-1);ray(m,p,0,1,1);ray(m,p,0,-1,1);ray(m,p,0,1,-1);ray(m,p,0,-1,-1);return m;}
function getKingMoves(p){const moves=[],{x,y,z}=p.userData;for(let dx=-1;dx<=1;dx++){for(let dy=-1;dy<=1;dy++){if(dx===0&&dy===0)continue;const tx=x+dx,ty=y+dy;if(tx<0||tx>7||ty<0||ty>7)continue;if(isHole(tx,ty,z))continue;const t=occ(tx,ty,z);if(!t||t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z:z});}}[[0,0,1],[0,0,-1]].forEach(function(d){const tz=z+d[2];if(tz<0||tz>=LAYERS)return;if(isHole(x,y,tz))return;const t=occ(x,y,tz);if(!t||t.userData.color!==p.userData.color)moves.push({x:x,y:y,z:tz});});if(!p.userData.moved){const row=y,layer=z;let r=occ(7,row,layer);if(r&&r.userData.type==='rook'&&!r.userData.moved&&!occ(5,row,layer)&&!occ(6,row,layer)&&!isHole(5,row,layer)&&!isHole(6,row,layer))moves.push({x:6,y:row,z:layer,castle:'kingside'});r=occ(0,row,layer);if(r&&r.userData.type==='rook'&&!r.userData.moved&&!occ(1,row,layer)&&!occ(2,row,layer)&&!occ(3,row,layer)&&!isHole(1,row,layer)&&!isHole(2,row,layer)&&!isHole(3,row,layer))moves.push({x:2,y:row,z:layer,castle:'queenside'});}return moves;}
function getPawnMoves(p){const moves=[],dir=p.userData.color==='white'?1:-1,x=p.userData.x,y=p.userData.y,z=p.userData.z;const f1=y+dir,f2=y+dir*2;if(f1>=0&&f1<8&&!occ(x,f1,z)&&!isHole(x,f1,z))moves.push({x:x,y:f1,z:z});if(!p.userData.moved&&f2>=0&&f2<8&&!occ(x,f1,z)&&!occ(x,f2,z)&&!isHole(x,f1,z)&&!isHole(x,f2,z))moves.push({x:x,y:f2,z:z,doublePushY:true});const u1=z+dir,u2=z+dir*2;if(u1>=0&&u1<LAYERS&&!occ(x,y,u1)&&!isHole(x,y,u1))moves.push({x:x,y:y,z:u1});if(!p.userData.moved&&u2>=0&&u2<LAYERS&&!occ(x,y,u1)&&!occ(x,y,u2)&&!isHole(x,y,u1)&&!isHole(x,y,u2))moves.push({x:x,y:y,z:u2,doublePushZ:true});[[1,dir],[-1,dir]].forEach(function(d){const tx=x+d[0],ty=y+d[1];if(tx>=0&&tx<8&&ty>=0&&ty<8){const t=occ(tx,ty,z);if(t&&t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z:z});}});[[1,dir],[-1,dir]].forEach(function(d){const tx=x+d[0],tz=z+d[1];if(tx>=0&&tx<8&&tz>=0&&tz<LAYERS){const t=occ(tx,y,tz);if(t&&t.userData.color!==p.userData.color)moves.push({x:tx,y:y,z:tz});}});[1,-1].forEach(function(dx){const tx=x+dx,ty=y+dir,tz=z+dir;if(tx>=0&&tx<8&&ty>=0&&ty<8&&tz>=0&&tz<LAYERS){const t=occ(tx,ty,tz);if(t&&t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z:tz});}});if(lastDoublePawn&&lastDoublePawn.color!==p.userData.color){const ep=lastDoublePawn;if(ep.pz===z&&Math.abs(ep.px-x)===1){if(ep.doublePushY&&ep.py===y){const capY=ep.py+dir;if(capY>=0&&capY<8&&!occ(ep.px,capY,z))moves.push({x:ep.px,y:capY,z:z,enPassant:{px:ep.px,py:ep.py,pz:ep.pz}});}}if(ep.doublePushZ&&ep.px===x&&Math.abs(ep.pz-z)===1){const capZ=ep.pz-dir;if(capZ>=0&&capZ<LAYERS&&!occ(x,y,capZ))moves.push({x:x,y:y,z:capZ,enPassant:{px:ep.px,py:ep.py,pz:ep.pz}});}}return moves;}
function getPseudoMoves(p){switch(p.userData.type){case'knight':return getKnightMoves(p);case'rook':return getRookMoves(p);case'bishop':return getBishopMoves(p);case'queen':return getQueenMoves(p);case'king':return getKingMoves(p);default:return getPawnMoves(p);}}
function isInCheck(color){const kg=pieces.find(function(p){return p.userData.type==='king'&&p.userData.color===color;});if(!kg)return false;for(let i=0;i<pieces.length;i++){const piece=pieces[i];if(piece.userData.color===color)continue;if(getPseudoMoves(piece).some(function(m){return m.x===kg.userData.x&&m.y===kg.userData.y&&m.z===kg.userData.z;}))return true;}return false;}
function withSimulatedMove(piece,move,callback){const ox=piece.userData.x,oy=piece.userData.y,oz=piece.userData.z,om=piece.userData.moved;const victim=occ(move.x,move.y,move.z);const ok=key(ox,oy,oz),nk=key(move.x,move.y,move.z);delete boardMap[ok];if(victim)delete boardMap[nk];boardMap[nk]=piece;piece.userData.x=move.x;piece.userData.y=move.y;piece.userData.z=move.z;let vi=-1;if(victim){vi=pieces.indexOf(victim);pieces.splice(vi,1);}let epVictim=null,epVi=-1,epKey=null;if(move.enPassant){const ep=move.enPassant;epKey=key(ep.px,ep.py,ep.pz);epVictim=boardMap[epKey];if(epVictim){delete boardMap[epKey];epVi=pieces.indexOf(epVictim);if(epVi!==-1)pieces.splice(epVi,1);}}const result=callback();if(epVictim){if(epVi!==-1)pieces.splice(epVi,0,epVictim);boardMap[epKey]=epVictim;}if(victim)pieces.splice(vi,0,victim);delete boardMap[nk];boardMap[ok]=piece;if(victim)boardMap[nk]=victim;piece.userData.x=ox;piece.userData.y=oy;piece.userData.z=oz;piece.userData.moved=om;return result;}
function getLegalMoves(piece){return getPseudoMoves(piece).filter(function(m){if(m.castle){if(isInCheck(piece.userData.color))return false;const midX=m.castle==='kingside'?5:3;if(!withSimulatedMove(piece,{x:midX,y:m.y,z:m.z},function(){return!isInCheck(piece.userData.color);}))return false;}return withSimulatedMove(piece,m,function(){return!isInCheck(piece.userData.color);});});}
function getBoardHash(){return JSON.stringify(pieces.map(function(p){return p.userData.type[0]+p.userData.color[0]+p.userData.x+p.userData.y+p.userData.z;}).sort().join('|'));}
function botGetPieceValue(p){return BOT_VALUES[p.userData.type]||0;}
function botDistFromCenter(x,y,z){const dx=x-3.5,dy=y-3.5,dz=z-(LAYERS-1)/2;return Math.sqrt(dx*dx+dy*dy+dz*dz);}
function botSmallestAttacker(x,y,z,byColor){let smallest=Infinity;for(let i=0;i<pieces.length;i++){const p=pieces[i];if(p.userData.color!==byColor)continue;if(getPseudoMoves(p).some(function(m){return m.x===x&&m.y===y&&m.z===z;})){const v=botGetPieceValue(p);if(v<smallest)smallest=v;}}return smallest===Infinity?0:smallest;}
function botPawnPromoDist(p){if(p.userData.type!=='pawn')return 0;const white=p.userData.color==='white';return white?(7-p.userData.y):p.userData.y;}
function botEvalPosition(color){const opp=color==='white'?'black':'white';let score=0;for(let i=0;i<pieces.length;i++){const p=pieces[i];const v=botGetPieceValue(p);const own=p.userData.color===color;score+=own?v:-v;const centreBonus=-botDistFromCenter(p.userData.x,p.userData.y,p.userData.z)*0.05;score+=own?centreBonus:-centreBonus;if(p.userData.type==='pawn'){const closeness=(p.userData.color==='white'?6:1)-botPawnPromoDist(p);const promoBonus=closeness*0.12;score+=own?promoBonus:-promoBonus;}}let myMobility=0,oppMobility=0;for(let i=0;i<pieces.length;i++){const p=pieces[i];const pm=getPseudoMoves(p).length;if(p.userData.color===color)myMobility+=pm;else oppMobility+=pm;}score+=(myMobility-oppMobility)*0.05;return score;}
function botScoreMove(piece,move){const color=piece.userData.color;const opp=color==='white'?'black':'white';const victim=occ(move.x,move.y,move.z);return withSimulatedMove(piece,move,function(){let score=botEvalPosition(color);if(victim){const capVal=botGetPieceValue(victim);const attacker=botSmallestAttacker(move.x,move.y,move.z,opp);score+=capVal;if(attacker>0){score-=Math.max(0,botGetPieceValue(piece)-capVal)*0.5;}}const smallestEnemy=botSmallestAttacker(move.x,move.y,move.z,opp);if(smallestEnemy>0){const hanging=botGetPieceValue(piece)-smallestEnemy;if(hanging>0)score-=hanging*0.5;}if(piece.userData.type==='pawn'){const white=color==='white';if((white&&move.y===7)||(!white&&move.y===0)){score+=BOT_VALUES.queen-BOT_VALUES.pawn;}else{const before=botPawnPromoDist(piece);const after=white?(7-move.y):move.y;score+=(before-after)*0.5;}}score-=botDistFromCenter(move.x,move.y,move.z)*0.05;score+=getPseudoMoves(piece).length*0.05;return score;});}
var _deadline=0;const _botTT=new Map();
function botMinimax(depth,alpha,beta,maximizing){if(Date.now()>_deadline)throw 42;const color=maximizing?botColor:(botColor==='white'?'black':'white');if(depth===0)return botEvalPosition(botColor);const ttKey=getBoardHash()+(maximizing?'M':'O')+depth;const tte=_botTT.get(ttKey);if(tte&&tte.d>=depth)return tte.s;const candidates=[];for(let i=0;i<pieces.length;i++){const p=pieces[i];if(p.userData.color!==color)continue;const lm=getLegalMoves(p);for(let j=0;j<lm.length;j++)candidates.push({piece:p,move:lm[j]});}if(!candidates.length){if(isInCheck(color))return maximizing?-9999:9999;return 0;}candidates.sort(function(a,b){var va=occ(a.move.x,a.move.y,a.move.z)?botGetPieceValue(occ(a.move.x,a.move.y,a.move.z)):0;var vb=occ(b.move.x,b.move.y,b.move.z)?botGetPieceValue(occ(b.move.x,b.move.y,b.move.z)):0;return vb-va;});let best;if(maximizing){best=-Infinity;for(let i=0;i<candidates.length;i++){const s=withSimulatedMove(candidates[i].piece,candidates[i].move,function(){return botMinimax(depth-1,alpha,beta,false);});if(s>best)best=s;if(s>alpha)alpha=s;if(beta<=alpha)break;}}else{best=Infinity;for(let i=0;i<candidates.length;i++){const s=withSimulatedMove(candidates[i].piece,candidates[i].move,function(){return botMinimax(depth-1,alpha,beta,true);});if(s<best)best=s;if(s<beta)beta=s;if(beta<=alpha)break;}}_botTT.set(ttKey,{s:best,d:depth});return best;}
function runBotMove(depth){_botTT.clear();var TIME_LIMITS=[0,600,1200,2000,2800,3500];_deadline=Date.now()+(TIME_LIMITS[Math.min(depth,5)]||2000);const candidates=[];for(let i=0;i<pieces.length;i++){const p=pieces[i];if(p.userData.color!==botColor)continue;const lm=getLegalMoves(p);for(let j=0;j<lm.length;j++)candidates.push({piece:p,move:lm[j]});}if(!candidates.length)return null;if(depth===0)return candidates[Math.floor(Math.random()*candidates.length)];candidates.sort(function(a,b){return botScoreMove(b.piece,b.move)-botScoreMove(a.piece,a.move);});var bestChoice=candidates[0];if(depth===1){var bestScore=-Infinity,bestC=[];for(var i=0;i<candidates.length;i++){var s=botScoreMove(candidates[i].piece,candidates[i].move);if(s>bestScore+0.0001){bestScore=s;bestC=[candidates[i]];}else if(s>=bestScore-0.0001)bestC.push(candidates[i]);}if(bestC.length)bestChoice=bestC[Math.floor(Math.random()*bestC.length)];}else{for(var d=1;d<=depth;d++){if(Date.now()>_deadline)break;var iterBest=-Infinity,iterC=[];var ok=true;for(var i=0;i<candidates.length;i++){try{var s=withSimulatedMove(candidates[i].piece,candidates[i].move,function(){return botMinimax(d-1,-Infinity,Infinity,false);});if(s>iterBest+0.0001){iterBest=s;iterC=[candidates[i]];}else if(s>=iterBest-0.0001)iterC.push(candidates[i]);}catch(e){ok=false;break;}}if(ok&&iterC.length){bestChoice=iterC[Math.floor(Math.random()*iterC.length)];(function(bc){candidates.sort(function(a,b){var ia=bc.indexOf(a)<0?1:0,ib=bc.indexOf(b)<0?1:0;return ia-ib;});})(iterC);}}}if(!bestChoice)bestChoice=candidates[Math.floor(Math.random()*candidates.length)];return{fromX:bestChoice.piece.userData.x,fromY:bestChoice.piece.userData.y,fromZ:bestChoice.piece.userData.z,toX:bestChoice.move.x,toY:bestChoice.move.y,toZ:bestChoice.move.z};}
self.onmessage=function(e){const d=e.data;pieces=d.piecesData.map(function(s){return{userData:{type:s.type,color:s.color,x:s.x,y:s.y,z:s.z,moved:s.moved}};});boardMap={};pieces.forEach(function(p){boardMap[key(p.userData.x,p.userData.y,p.userData.z)]=p;});holeSquares=new Set(d.holes||[]);lastDoublePawn=d.lastDP;botColor=d.bc;try{self.postMessage(runBotMove(d.depth));}catch(err){const all=[];pieces.forEach(function(p){if(p.userData.color!==botColor)return;getLegalMoves(p).forEach(function(m){all.push({piece:p,move:m});});});if(all.length){const c=all[Math.floor(Math.random()*all.length)];self.postMessage({fromX:c.piece.userData.x,fromY:c.piece.userData.y,fromZ:c.piece.userData.z,toX:c.move.x,toY:c.move.y,toZ:c.move.z});}else{self.postMessage(null);}}};
`;
})();

/* ── Show/hide bot thinking indicator ── */
function _showBotThinking() {
  const el = document.getElementById('botThinkingEl');
  if (el) { el.style.display = 'block'; requestAnimationFrame(function() { el.style.opacity = '1'; }); }
  let _d = 0;
  if (_botThinkingTimer) clearInterval(_botThinkingTimer);
  _botThinkingTimer = setInterval(function() {
    _d = (_d + 1) % 4;
    const de = document.getElementById('botThinkingDots');
    if (de) de.textContent = ['', ' .', ' ..', ' ...'][_d];
  }, 350);
}
function _hideBotThinking() {
  const el = document.getElementById('botThinkingEl');
  if (el) { el.style.opacity = '0'; setTimeout(function() { el.style.display = 'none'; }, 450); }
  if (_botThinkingTimer) { clearInterval(_botThinkingTimer); _botThinkingTimer = null; }
  const de = document.getElementById('botThinkingDots');
  if (de) de.textContent = '';
}

/* ── Called when the worker posts its move back ── */
function _onBotWorkerResult(data) {
  _hideBotThinking();
  botThinking = false;

  if (!data || !gameStarted || reviewing) {
    // Bot returned null — zero legal moves (laser blocked everything)
    if (data === null && gameStarted && !reviewing) {
      const hasAny = pieces.some(function(p) {
        return p.userData.color === botColor && getLegalMoves(p).length > 0;
      });
      if (!hasAny && !isInCheck(botColor)) {
        if (typeof arcadeAnnounce === 'function') arcadeAnnounce('Bot has no legal moves — turn passed', 0xffaa00);
        turn = turn === 'white' ? 'black' : 'white';
        update(); coords();
      }
    }
    return;
  }

  // Find the piece the worker chose (by position + color)
  const piece = pieces.find(function(p) {
    return p.userData.x === data.fromX && p.userData.y === data.fromY &&
           p.userData.z === data.fromZ && p.userData.color === botColor;
  });
  if (!piece) return;

  // Verify the move is still legal (board may have changed if game ended)
  const legal = getLegalMoves(piece);
  const move = legal.find(function(m) { return m.x === data.toX && m.y === data.toY && m.z === data.toZ; });
  if (!move) {
    // Fallback: pick any random legal bot move
    const allMoves = [];
    pieces.forEach(function(p) {
      if (p.userData.color !== botColor) return;
      getLegalMoves(p).forEach(function(m) { allMoves.push({ piece:p, move:m }); });
    });
    if (!allMoves.length) {
      // No legal moves at all — pass turn instead of freezing
      if (!isInCheck(botColor)) {
        if (typeof arcadeAnnounce === 'function') arcadeAnnounce('Bot has no legal moves — turn passed', 0xffaa00);
        turn = turn === 'white' ? 'black' : 'white';
        update(); coords();
      }
      return;
    }
    const c = allMoves[Math.floor(Math.random() * allMoves.length)];
    executeMove(c.piece, c.move);
    return;
  }

  executeMove(piece, move);
}

/* ── Debounced bot-move scheduler — cancels any pending timer before queuing a new one.
   Prevents double-move when two code paths both try to trigger the bot (e.g. normal
   turn flip + power-orb resolvePromotion both calling setTimeout(botMove) in the same
   turn pipeline). ── */
var _botMoveTimer = null;
function scheduleBotMove(delay) {
  if (_botMoveTimer !== null) clearTimeout(_botMoveTimer);
  _botMoveTimer = setTimeout(function() {
    _botMoveTimer = null;
    botMove();
  }, delay !== undefined ? delay : 900);
}

/* ── Main bot entry point — now async via Web Worker ── */
function botMove() {
  if (!botColor) return;

  // Serialize board state for the worker
  const piecesData = pieces.map(function(p) {
    return { type:p.userData.type, color:p.userData.color, x:p.userData.x, y:p.userData.y, z:p.userData.z, moved:!!p.userData.moved };
  });

  botThinking = true;
  _showBotThinking();

  // Create worker once; reuse across moves
  if (!_botWorker) {
    _botWorker = new Worker(URL.createObjectURL(new Blob([BOT_WORKER_SRC], { type:'text/javascript' })));
    _botWorker.onmessage = function(e) { _onBotWorkerResult(e.data); };
    _botWorker.onerror   = function(err) { console.warn('[Bot Worker]', err.message); _onBotWorkerResult(null); };
  }

  _botWorker.postMessage({
    piecesData : piecesData,
    lastDP     : lastDoublePawn,
    bc         : botColor,
    depth      : Math.min(botDepth, 5),
    holes      : Array.from(holeSquares)
  });
}

