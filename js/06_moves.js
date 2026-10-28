/* ======================================================
   MOVE GENERATION
====================================================== */
function ray(lm, piece, dx, dy, dz) {
  const { x, y, z } = piece.userData;
  for (let i = 1; i < 8; i++) {
    const tx = x+dx*i, ty = y+dy*i, tz = z+dz*i;
    if (tx<0||tx>7||ty<0||ty>7||tz<0||tz>=LAYERS) break;
    if (isHole(tx,ty,tz)) break;
    const t = occ(tx, ty, tz);
    if (!t) { lm.push({x:tx,y:ty,z:tz}); }
    else { if (t.userData.color !== piece.userData.color) lm.push({x:tx,y:ty,z:tz}); break; }
  }
}
function getKnightMoves(p) {
  const moves = [], { x, y, z } = p.userData;
  [[2,1,0],[2,-1,0],[-2,1,0],[-2,-1,0],[2,0,1],[2,0,-1],[-2,0,1],[-2,0,-1],[1,2,0],[1,-2,0],[-1,2,0],[-1,-2,0],[0,2,1],[0,2,-1],[0,-2,1],[0,-2,-1],[1,0,2],[1,0,-2],[-1,0,2],[-1,0,-2],[0,1,2],[0,1,-2],[0,-1,2],[0,-1,-2]]
  .forEach(([dx,dy,dz]) => { const tx=x+dx,ty=y+dy,tz=z+dz; if(tx<0||tx>7||ty<0||ty>7||tz<0||tz>=LAYERS)return; if(isHole(tx,ty,tz))return; const t=occ(tx,ty,tz); if(!t||t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z:tz}); });
  return moves;
}
function getRookMoves(p)   { const m=[]; ray(m,p,1,0,0);ray(m,p,-1,0,0);ray(m,p,0,1,0);ray(m,p,0,-1,0);ray(m,p,0,0,1);ray(m,p,0,0,-1); return m; }
function getBishopMoves(p) { const m=[]; ray(m,p,1,1,0);ray(m,p,-1,1,0);ray(m,p,1,-1,0);ray(m,p,-1,-1,0);ray(m,p,1,1,1);ray(m,p,-1,1,1);ray(m,p,1,-1,1);ray(m,p,-1,-1,1);ray(m,p,1,1,-1);ray(m,p,-1,1,-1);ray(m,p,1,-1,-1);ray(m,p,-1,-1,-1); return m; }

// QUEEN: same-layer omnidirectional (8) + straight up/down (2) + plus-diagonals between layers (8)
// Plus-diagonals: moves along one lateral axis AND the Z-axis simultaneously (the + cross pattern).
// Bishop keeps the × diagonals (all three axes at once). Queen gets the + between-layer diagonals.
function getQueenMoves(p)  { const m=[];
  // Same layer — 4 orthogonal + 4 diagonal (classic queen within layer)
  ray(m,p,1,0,0);ray(m,p,-1,0,0);ray(m,p,0,1,0);ray(m,p,0,-1,0);
  ray(m,p,1,1,0);ray(m,p,-1,1,0);ray(m,p,1,-1,0);ray(m,p,-1,-1,0);
  // Cross-layer: straight up/down
  ray(m,p,0,0,1);ray(m,p,0,0,-1);
  // Cross-layer: + diagonals (one lateral axis + Z) — distinct from bishop's × diagonals
  ray(m,p,1,0,1);ray(m,p,-1,0,1);ray(m,p,1,0,-1);ray(m,p,-1,0,-1);
  ray(m,p,0,1,1);ray(m,p,0,-1,1);ray(m,p,0,1,-1);ray(m,p,0,-1,-1);
  return m; }

function getKingMoves(p) {
  const moves = [], { x, y, z } = p.userData;
  for (let dx=-1;dx<=1;dx++) { for (let dy=-1;dy<=1;dy++) { if(dx===0&&dy===0)continue; const tx=x+dx,ty=y+dy; if(tx<0||tx>7||ty<0||ty>7)continue; if(isHole(tx,ty,z))continue; const t=occ(tx,ty,z); if(!t||t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z}); } }
  [[0,0,1],[0,0,-1]].forEach(([,,dz]) => { const tz=z+dz; if(tz<0||tz>=LAYERS)return; if(isHole(x,y,tz))return; const t=occ(x,y,tz); if(!t||t.userData.color!==p.userData.color)moves.push({x,y,z:tz}); });
  if (!p.userData.moved) { const row=y,layer=z; let r=occ(7,row,layer); if(r&&r.userData.type==="rook"&&!r.userData.moved&&!occ(5,row,layer)&&!occ(6,row,layer)&&!isHole(5,row,layer)&&!isHole(6,row,layer))moves.push({x:6,y:row,z:layer,castle:"kingside"}); r=occ(0,row,layer); if(r&&r.userData.type==="rook"&&!r.userData.moved&&!occ(1,row,layer)&&!occ(2,row,layer)&&!occ(3,row,layer)&&!isHole(1,row,layer)&&!isHole(2,row,layer)&&!isHole(3,row,layer))moves.push({x:2,y:row,z:layer,castle:"queenside"}); }
  return moves;
}
function getPawnMoves(p) {
  const moves = [], dir=p.userData.color==="white"?1:-1, {x,y,z}=p.userData;
  const f1=y+dir,f2=y+dir*2;
  if(f1>=0&&f1<8&&!occ(x,f1,z)&&!isHole(x,f1,z))moves.push({x,y:f1,z});
  if(!p.userData.moved&&f2>=0&&f2<8&&!occ(x,f1,z)&&!occ(x,f2,z)&&!isHole(x,f1,z)&&!isHole(x,f2,z))moves.push({x,y:f2,z,doublePushY:true});
  const u1=z+dir,u2=z+dir*2;
  if(u1>=0&&u1<LAYERS&&!occ(x,y,u1)&&!isHole(x,y,u1))moves.push({x,y,z:u1});
  if(!p.userData.moved&&u2>=0&&u2<LAYERS&&!occ(x,y,u1)&&!occ(x,y,u2)&&!isHole(x,y,u1)&&!isHole(x,y,u2))moves.push({x,y,z:u2,doublePushZ:true});
  [[1,dir],[-1,dir]].forEach(([dx,dy]) => { const tx=x+dx,ty=y+dy; if(tx>=0&&tx<8&&ty>=0&&ty<8){const t=occ(tx,ty,z);if(t&&t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z});} });
  [[1,dir],[-1,dir]].forEach(([dx,dz]) => { const tx=x+dx,tz=z+dz; if(tx>=0&&tx<8&&tz>=0&&tz<LAYERS){const t=occ(tx,y,tz);if(t&&t.userData.color!==p.userData.color)moves.push({x:tx,y,z:tz});} });
  // 3D body-diagonal capture: forward in both Y and Z axes only (z+dir ensures no backward z capture)
  [1,-1].forEach(dx => { const tx=x+dx,ty=y+dir,tz=z+dir; if(tx>=0&&tx<8&&ty>=0&&ty<8&&tz>=0&&tz<LAYERS){const t=occ(tx,ty,tz);if(t&&t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z:tz});} });
  // En passant — 3D: capture the pawn that just double-pushed
  if(lastDoublePawn && lastDoublePawn.color !== p.userData.color) {
    const ep = lastDoublePawn;
    // Same layer, adjacent file, capture lands where the pawn passed through
    if(ep.pz === z && Math.abs(ep.px - x) === 1) {
      // Y double-push: our pawn must be on same rank as the target, capture goes forward
      if(ep.doublePushY && ep.py === y) {
        const capY = ep.py + dir; // passed-through square: forward from enemy destination
        if(capY >= 0 && capY < 8 && !occ(ep.px, capY, z))
          moves.push({x:ep.px, y:capY, z, enPassant:{px:ep.px,py:ep.py,pz:ep.pz}});
      }
    }
    // Z double-push: same file, adjacent layer, capture across layer
    if(ep.doublePushZ && ep.px === x && Math.abs(ep.pz - z) === 1) {
      const capZ = ep.pz - dir;
      if(capZ >= 0 && capZ < LAYERS && !occ(x, y, capZ))
        moves.push({x, y, z:capZ, enPassant:{px:ep.px,py:ep.py,pz:ep.pz}});
    }
  }
  return moves;
}
function getPseudoMoves(p) {
  switch(p.userData.type) { case "knight":return getKnightMoves(p); case "rook":return getRookMoves(p); case "bishop":return getBishopMoves(p); case "queen":return getQueenMoves(p); case "king":return getKingMoves(p); default:return getPawnMoves(p); }
}

/* ======================================================
   GAME RULES
====================================================== */
function isInCheck(color) {
  const kg = pieces.find(p => p.userData.type==="king"&&p.userData.color===color);
  if(!kg) return false;
  for(const piece of pieces) { if(piece.userData.color===color)continue; if(getPseudoMoves(piece).some(m=>m.x===kg.userData.x&&m.y===kg.userData.y&&m.z===kg.userData.z))return true; }
  return false;
}
function withSimulatedMove(piece, move, callback) {
  const ox=piece.userData.x,oy=piece.userData.y,oz=piece.userData.z,om=piece.userData.moved;
  const victim=occ(move.x,move.y,move.z);
  const ok=key(ox,oy,oz),nk=key(move.x,move.y,move.z);
  delete boardMap[ok]; if(victim)delete boardMap[nk]; boardMap[nk]=piece;
  piece.userData.x=move.x; piece.userData.y=move.y; piece.userData.z=move.z;
  let vi=-1; if(victim){vi=pieces.indexOf(victim);pieces.splice(vi,1);}
  // En passant: also remove the captured pawn from its actual square during simulation
  let epVictim=null, epVi=-1, epKey=null;
  if(move.enPassant){
    const ep=move.enPassant;
    epKey=key(ep.px,ep.py,ep.pz);
    epVictim=boardMap[epKey];
    if(epVictim){delete boardMap[epKey];epVi=pieces.indexOf(epVictim);if(epVi!==-1)pieces.splice(epVi,1);}
  }
  const result=callback();
  // Restore en passant victim
  if(epVictim){if(epVi!==-1)pieces.splice(epVi,0,epVictim);boardMap[epKey]=epVictim;}
  if(victim)pieces.splice(vi,0,victim);
  delete boardMap[nk]; boardMap[ok]=piece; if(victim)boardMap[nk]=victim;
  piece.userData.x=ox; piece.userData.y=oy; piece.userData.z=oz; piece.userData.moved=om;
  return result;
}
function getLegalMoves(piece) {
  return getPseudoMoves(piece).filter(m => {
    if (m.castle) {
      // King may not castle out of check
      if (isInCheck(piece.userData.color)) return false;
      // King may not pass through an attacked square
      const midX = m.castle === 'kingside' ? 5 : 3;
      if (!withSimulatedMove(piece, {x:midX, y:m.y, z:m.z}, () => !isInCheck(piece.userData.color))) return false;
    }
    return withSimulatedMove(piece, m, () => !isInCheck(piece.userData.color));
  });
}
function hasLegalMoves(color) { for(const p of pieces)if(p.userData.color===color&&getLegalMoves(p).length>0)return true; return false; }
function calc(p,silent=false) { legalMoves=[]; if(!silent){movePlates.forEach(m=>pivot.remove(m));movePlates=[];pulsePlates=[];} legalMoves=getPseudoMoves(p); if(!silent){legalMoves.forEach(m=>{const plate=square(m.x,m.y,m.z,false);movePlates.push(plate);});} }

