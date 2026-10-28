/* ======================================================
   ANIMATION SYSTEM
====================================================== */
function worldPos(x,y,z) { return new THREE.Vector3(-half+(x+0.5)*SPACING,layers[z].position.y,-half+(y+0.5)*SPACING); }
function animateSlide(piece,from,to,speed=0.05){const start=worldPos(from.x,from.y,from.z),end=worldPos(to.x,to.y,to.z);pivot.add(piece);animations.push({t:0,speed,update(t){piece.position.lerpVectors(start,end,t);},end(){if(!pieces.includes(piece)){if(piece.parent)piece.parent.remove(piece);return;}piece.position.set(end.x,0,end.z);layers[to.z].add(piece);}});}
function animateJump(piece,from,to){const start=worldPos(from.x,from.y,from.z),end=worldPos(to.x,to.y,to.z);pivot.add(piece);animations.push({t:0,speed:0.08,update(t){piece.position.lerpVectors(start,end,t);piece.position.y+=Math.sin(t*Math.PI)*1.2;},end(){if(!pieces.includes(piece)){if(piece.parent)piece.parent.remove(piece);return;}piece.position.set(end.x,0,end.z);layers[to.z].add(piece);}});}
function animateFloat(piece,from,to){const start=worldPos(from.x,from.y,from.z),end=worldPos(to.x,to.y,to.z);pivot.add(piece);animations.push({t:0,speed:0.03,update(t){piece.position.lerpVectors(start,end,t);piece.position.y+=Math.sin(t*Math.PI)*0.6;},end(){if(!pieces.includes(piece)){if(piece.parent)piece.parent.remove(piece);return;}piece.position.set(end.x,0,end.z);layers[to.z].add(piece);}});}
function animateFade(piece,from,to){const end=worldPos(to.x,to.y,to.z);pivot.add(piece);animations.push({t:0,speed:0.12,update(t){setPieceMat(piece,{transparent:true,opacity:Math.abs(Math.sin(t*20))});},end(){if(!pieces.includes(piece)){if(piece.parent)piece.parent.remove(piece);return;}piece.position.set(end.x,0,end.z);setPieceMat(piece,{opacity:1,transparent:false});layers[to.z].add(piece);}});}
function animateMove(piece,from,to){const type=piece.userData.type;if(type==="pawn"||type==="rook"||type==="king")animateSlide(piece,from,to,0.05);else if(type==="knight")animateJump(piece,from,to);else if(type==="queen")animateFloat(piece,from,to);else if(type==="bishop")animateSlide(piece,from,to,0.05);}
function runAnimations(){for(let i=animations.length-1;i>=0;i--){const a=animations[i];a.t+=a.speed;a.update(a.t);if(a.t>=1){a.end();animations.splice(i,1);}}}

/* ======================================================
   RENDERING: Highlights
====================================================== */
// Single source of truth: is layer z currently showing?
// Mirrors the exact same logic used in update() to set layer.visible.
function isLayerShowing(z) {
  if (typeof cameraMode !== 'undefined' && typeof CAMERA_MODES !== 'undefined') {
    if (cameraMode === CAMERA_MODES.FLAT) return z === activeZ;
  }
  if (typeof LAYER_VIS === 'undefined') return true;
  if (LAYER_VIS.mode === 'current') return z === activeZ;
  if (LAYER_VIS.mode === 'all') return true;
  const spread = Math.floor((LAYER_VIS.count - 1) / 2);
  const cap = (typeof cameraMode !== 'undefined' && typeof CAMERA_MODES !== 'undefined' &&
               cameraMode === CAMERA_MODES.SLICE) ? 1 : spread;
  return Math.abs(z - activeZ) <= Math.min(spread, cap);
}

function square(x, y, z, strong=false, colorHex=null, opacityVal=null) {
  const baseOpacity = opacityVal !== null ? opacityVal : (strong ? 0.75 : 0.32);
  const color = colorHex !== null ? colorHex : (strong ? CFG.hl.selection.color : CFG.hl.legal.color);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color, transparent:true, opacity:baseOpacity, side:THREE.DoubleSide}));
  m.rotation.x = -Math.PI/2;
  m.position.set(-half+(x+0.5)*SPACING, layers[z].position.y+0.01, -half+(y+0.5)*SPACING);
  m.userData.baseOpacity = baseOpacity;
  m.userData.x = x; m.userData.y = y; m.userData.z = z;
  // Immediately respect current layer visibility
  if (!isLayerShowing(z)) m.visible = false;
  pivot.add(m);
  if(!strong) pulsePlates.push(m);
  scheduleTileReveal();
  return m;
}
function showLastMove(from,to){lastMoveSquares.forEach(p=>pivot.remove(p));lastMoveSquares=[];if(!CFG.hl.lastMove.on)return;const col=CFG.hl.lastMove.color,op=CFG.hl.lastMove.opacity;const a=square(from.x,from.y,from.z,true,col,op*0.5),b=square(to.x,to.y,to.z,true,col,op);lastMoveSquares.push(a,b);}
function refreshLastMove(){if(lastMoveSquares.length===2){lastMoveSquares[0].material.color.setHex(CFG.hl.lastMove.color);lastMoveSquares[0].material.opacity=CFG.hl.lastMove.opacity*0.5;lastMoveSquares[0].visible=CFG.hl.lastMove.on&&isLayerShowing(lastMoveSquares[0].userData.z);lastMoveSquares[1].material.color.setHex(CFG.hl.lastMove.color);lastMoveSquares[1].material.opacity=CFG.hl.lastMove.opacity;lastMoveSquares[1].visible=CFG.hl.lastMove.on&&isLayerShowing(lastMoveSquares[1].userData.z);}}
function refreshLegalMoveHighlights(){movePlates.forEach(p=>{p.material.color.setHex(CFG.hl.legal.color);p.userData.baseOpacity=CFG.hl.legal.opacity;p.visible=CFG.hl.legal.on&&isLayerShowing(p.userData.z);});}
function refreshThreatHighlights(){threatPlates.forEach(p=>{p.material.color.setHex(CFG.hl.threats.color);p.visible=CFG.hl.threats.on&&(p.userData.z===undefined||isLayerShowing(p.userData.z));});}
function showThreatLines(color){clearThreatLines();if(!CFG.hl.threats.on)return;const kg=pieces.find(p=>p.userData.type==="king"&&p.userData.color===color);if(!kg)return;pieces.filter(p=>p.userData.color!==color).forEach(piece=>{const pseudo=getPseudoMoves(piece);if(!pseudo.some(m=>m.x===kg.userData.x&&m.y===kg.userData.y&&m.z===kg.userData.z))return;
    // Knights and pawns jump — no ray to draw, just show a threat arrow
    const isSlider = piece.userData.type==='rook'||piece.userData.type==='bishop'||piece.userData.type==='queen';
    if(isSlider){
      const dx=Math.sign(kg.userData.x-piece.userData.x),dy=Math.sign(kg.userData.y-piece.userData.y),dz=Math.sign(kg.userData.z-piece.userData.z);
      if(dx!==0||dy!==0||dz!==0){
        let cx=piece.userData.x+dx,cy=piece.userData.y+dy,cz=piece.userData.z+dz;
        let steps=0;
        while((cx!==kg.userData.x||cy!==kg.userData.y||cz!==kg.userData.z)&&steps<16){
          const plate=square(cx,cy,cz,true,CFG.hl.threats.color,CFG.hl.threats.opacity);
          plate.userData={x:cx,y:cy,z:cz};threatPlates.push(plate);
          cx+=dx;cy+=dy;cz+=dz;steps++;
        }
      }
    }
    // 3D threat arrow from attacker to king
    if(UI_PREFS.threatArrows){
      const LIFT=0.7;
      const start=worldPos(piece.userData.x,piece.userData.y,piece.userData.z);start.y+=LIFT;
      const end=worldPos(kg.userData.x,kg.userData.y,kg.userData.z);end.y+=LIFT;
      const dir=new THREE.Vector3().subVectors(end,start);
      const len=dir.length();if(len<0.01)return;
      const hl=Math.max(0.4,len*0.25),hw=hl*0.55;
      const _thCol=(window.CZ_ARROWS&&window.CZ_ARROWS.threat)||0xff2200;
      const arr=new THREE.ArrowHelper(dir.normalize(),start,len,_thCol,hl,hw);
      arr.traverse(o=>{if(o.material){o.material.depthTest=false;o.material.depthWrite=false;o.renderOrder=98;}});
      arr.renderOrder=98;pivot.add(arr);threatPlates.push(arr);
    }
  });
}
function clearThreatLines(){threatPlates.forEach(p=>pivot.remove(p));threatPlates=[];}
function fadeHighlight(x,y,z,piece){const cfg=piece.userData.color==="white"?CFG.pieces.white:CFG.pieces.black;const plate=square(x,y,z,true,cfg.outlineSelColor,CFG.hl.selection.opacity);let t=0;function fade(){t+=0.03;plate.material.opacity=CFG.hl.selection.opacity*(1-t);setPieceMat(piece,{transparent:true,opacity:1-0.7*t});if(t<1){requestAnimationFrame(fade);}else{pivot.remove(plate);setPieceMat(piece,{opacity:1,transparent:false});update();}}fade();}

/* The board's checkered tiles are drawn ONLY on the active layer (see the
   `i === activeZ` test below). A move highlight on any other layer therefore
   has nothing under it and composites straight against the slab and the sky,
   so the same plate colour renders far darker than it does on the active
   layer. Measured with a knight selected, cosmic glass on:

     white knight, moves on the active layer   → luminance 196–208
     black knight, moves a layer or three away → luminance 143–167

   Black's army starts on layer 4 while the player sits on layer 1, so EVERY
   black move square is in the dark case — which is exactly how it reads in
   play: "black's moves make the squares dark", and moves that go up or down a
   layer not matching the ones that go forward.

   Rather than special-case the colour, put the missing surface back: reveal
   the board tile beneath each off-layer highlight so it sits on exactly the
   same thing a same-layer highlight does. update() re-hides every non-active
   tile on each pass before this runs, so the reveal is self-correcting — a
   tile stays visible only while a highlight is actually on it. */
const _hlBackings = [];   // pooled opaque quads drawn under off-layer highlights

/* Give every off-layer highlight the same surface a same-layer one gets.

   Revealing the board tile alone is not enough, because the tile is not what
   dominates: under cosmic glass the LOWEST slab is an opaque periwinkle base
   while the three above it are thin frosted sheets, so a plate on layer 1
   composites over a bright solid and a plate on layer 4 composites over most
   of the night sky. Measured, knight selected:

     white knight, moves on the active layer  → luminance 196-208
     black knight, moves on layers 2-4        → luminance 143-167

   So paint the missing backdrop instead: an opaque quad just under the plate,
   coloured by copying the ACTIVE layer's tile at the same (x, y). Copying
   rather than hardcoding is what makes this exact — the same file/rank has the
   same light/dark parity, so an upward move ends up over literally the colour
   a forward move sits on, in every board theme, with no constant to re-tune
   when the palette changes. */
function revealTilesUnderHighlights() {
  if (typeof layers === 'undefined' || typeof pivot === 'undefined') return;
  _hlBackings.forEach(b => { b.visible = false; });

  const marks = [];
  const add = arr => { if (arr) arr.forEach(m => { if (m && m.userData && m.visible !== false) marks.push(m.userData); }); };
  add(typeof movePlates !== 'undefined' ? movePlates : null);
  add(typeof lastMoveSquares !== 'undefined' ? lastMoveSquares : null);
  if (typeof selPlate !== 'undefined' && selPlate && selPlate.userData) marks.push(selPlate.userData);
  if (!marks.length) return;

  const activeLayer = layers[activeZ];
  if (!activeLayer) return;
  let used = 0;

  for (const mk of marks) {
    const z = mk.z;
    if (z === undefined || z === activeZ) continue;    // already on the lit surface
    const layer = layers[z];
    if (!layer || !layer.visible) continue;            // layer hidden outright

    // The active layer's tile at this file/rank — same parity, so same colour.
    let tint = null;
    for (const obj of activeLayer.children) {
      if (obj.isMesh && obj.userData && obj.userData.x === mk.x &&
          obj.userData.y === mk.y && !obj.userData.isHole && obj.material) {
        tint = obj.material.color; break;
      }
    }
    if (!tint) continue;

    let b = _hlBackings[used];
    if (!b) {
      b = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        /* Not fully opaque: on the active layer the tile is itself part of a
           stack (tile over the lit base slab), so painting the raw tile colour
           solid overshoots — measured 226 against the same-layer 207. Letting a
           little of the real backdrop through lands the two on each other. */
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true,
                                      opacity: 0.72, depthWrite: false })
      );
      b.rotation.x = -Math.PI / 2;
      pivot.add(b);
      _hlBackings.push(b);
    }
    b.material.color.copy(tint);
    // 0.004 under the plate's own 0.01 lift: above the slab, below the highlight.
    b.position.set(-half + (mk.x + 0.5) * SPACING,
                   layers[z].position.y + 0.004,
                   -half + (mk.y + 0.5) * SPACING);
    b.visible = true;
    b.renderOrder = -1;
    used++;
  }
}

/* Highlights are created in bursts — one square() call per legal move — and
   the selection path never calls update(). Coalesce to one pass per burst on
   a microtask so a 30-move queen costs a single sweep, not thirty. */
let _revealQueued = false;
function scheduleTileReveal() {
  if (_revealQueued) return;
  _revealQueued = true;
  Promise.resolve().then(() => { _revealQueued = false; revealTilesUnderHighlights(); });
}

function update() {
  layers.forEach((layer,i) => {
    let visible;
    if (typeof cameraMode !== 'undefined' && cameraMode === CAMERA_MODES.FLAT) {
      // FLAT mode: always show only the active layer, regardless of LAYER_VIS setting
      visible = (i === activeZ);
    } else if (LAYER_VIS.mode === 'current') {
      visible = (i === activeZ);
    } else if (LAYER_VIS.mode === 'all') {
      visible = true;
    } else {
      const spread = Math.floor((LAYER_VIS.count - 1) / 2);
      const cap = (typeof cameraMode !== 'undefined' && cameraMode === CAMERA_MODES.SLICE) ? 1 : spread;
      visible = Math.abs(i - activeZ) <= Math.min(spread, cap);
    }
    layer.visible = visible;
    if(!visible) return;
    layer.children.forEach(obj => {
      if(obj.type==="LineSegments"){
        if(obj.userData.isCgGrid || obj.userData.isCgEdge) return; // cosmic glass overlays managed separately
        obj.material.color.setHex(i===activeZ?CFG.grid.activeColor:CFG.grid.dimColor);
        const sliceDim = (typeof cameraMode!=='undefined' && cameraMode===CAMERA_MODES.SLICE && i!==activeZ);
        obj.material.opacity = sliceDim ? 0.15 : (i===activeZ?CFG.grid.activeOpacity:CFG.grid.dimOpacity);
      }
      // Show textured board squares on active layer (skip hole squares)
      if(obj.isMesh && obj.userData && 'x' in obj.userData){
        obj.visible = !obj.userData.isHole && (i === activeZ);
      }
    });
  });
  pieces.forEach(p => {
    const _pcfg = p.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
    const _baseOp = (_pcfg && _pcfg.baseOpacity !== undefined) ? _pcfg.baseOpacity : 1.0;
    if(typeof cameraMode === 'undefined'){
      const on=p.userData.z===activeZ;
      setPieceMat(p,{transparent:_baseOp<1||!on,opacity:on?_baseOp:_baseOp*0.25});
      return;
    }
    if(cameraMode === CAMERA_MODES.FLAT){
      const on=p.userData.z===activeZ;
      setPieceMat(p,{transparent:true,opacity:on?_baseOp:0});
    } else if(cameraMode === CAMERA_MODES.SLICE){
      const dist=Math.abs(p.userData.z-activeZ);
      if(dist===0)       setPieceMat(p,{transparent:_baseOp<1,opacity:_baseOp});
      else if(dist===1)  setPieceMat(p,{transparent:true, opacity:_baseOp*0.18});
      else               setPieceMat(p,{transparent:true, opacity:0});
    } else {
      const on=p.userData.z===activeZ;
      setPieceMat(p,{transparent:_baseOp<1||!on,opacity:on?_baseOp:_baseOp*0.25});
    }
  });
  // Sync all highlight plate visibility with current layer state
  refreshLegalMoveHighlights();
  refreshLastMove();
  // …then put a board tile back under whichever of them ended up off-layer,
  // so an upward move reads exactly like a forward one. Must run LAST: the
  // two refreshes above decide which plates are visible at all.
  revealTilesUnderHighlights();
}
function normalizeMaterial(p){
  const _ncfg = p && p.userData ? (p.userData.color==='white'?CFG.pieces.white:CFG.pieces.black) : null;
  const _nop = (_ncfg && _ncfg.baseOpacity!==undefined) ? _ncfg.baseOpacity : 1.0;
  setPieceMat(p,{transparent:_nop<1,opacity:_nop});
}

function showBotHint() {
  if (botThinking || !gameStarted || reviewing) return;
  const candidates = [];
  for (const p of pieces) {
    if (p.userData.color !== turn) continue;
    if (botColor && p.userData.color !== playerColor) continue;
    for (const m of getLegalMoves(p)) candidates.push({ piece: p, move: m });
  }
  if (!candidates.length) return;
  let best = candidates[0], bestScore = -Infinity;
  for (const c of candidates) { const s = botScoreMove(c.piece, c.move); if (s > bestScore) { bestScore = s; best = c; } }
  const cfg = best.piece.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
  setOutlineColor(best.piece, cfg.outlineSelColor);
  setTimeout(() => { if (pieces.includes(best.piece)) setOutlineColor(best.piece, cfg.outlineColor); }, 2000);
  showLastMove({ x: best.piece.userData.x, y: best.piece.userData.y, z: best.piece.userData.z }, best.move);
  if (best.piece.userData.z !== activeZ) { activeZ = best.piece.userData.z; const sl=document.getElementById('zSlider'); if(sl)sl.value=activeZ; update(); coords(); camOnLayerChange(); }
  SND.ui();
}

function doUndo() {
  if (reviewing || botThinking || !history.length) return;
  const stepsBack = (botColor && !PUZZLE_MODE) ? Math.min(2, history.length) : 1;
  const targetIdx = history.length - 1 - stepsBack;
  if (targetIdx < 0) {
    resetBoard(false);
    moveLog=[]; history=[]; snapshots=[]; turn='white'; moveNumber=1;
    document.getElementById('movePanel').innerHTML='<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button id="copyMoves" class="copyBtn"><div class="copySq1"></div><div class="copySq2"></div></button></div>';
    rebuildCopyButton();
    const mb=document.getElementById('moveNumBar'); if(mb) mb.style.display='none';
  } else {
    loadHistory(targetIdx);
    history.length=targetIdx+1; snapshots.length=targetIdx+1; moveLog.length=targetIdx+1;
    const last=moveLog[moveLog.length-1];
    turn=last.turn==='white'?'black':'white';
    moveNumber=last.turn==='black'?last.number+1:last.number;
    const panel=document.getElementById('movePanel');
    if(panel){
      panel.innerHTML='<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button id="copyMoves" class="copyBtn"><div class="copySq1"></div><div class="copySq2"></div></button></div>';
      rebuildCopyButton();
      moveLog.forEach((m,idx)=>{const div=document.createElement('div');div.textContent=(m.turn==='white'?m.number+'. ':'   ')+m.piece+squareName(m.from.x,m.from.y,m.from.z)+(m.capture?'x':'-')+squareName(m.to.x,m.to.y,m.to.z);div.style.cursor='pointer';div.onclick=()=>{setReviewing(true);reviewIndex=idx;loadHistory(idx);updateReviewUI();};panel.appendChild(div);});
    }
    reviewIndex=history.length-1; syncMoveNumBar();
    const mb=document.getElementById('moveNumBar'); if(mb) mb.style.display=history.length>0?'flex':'none';
  }
  lastDoublePawn=null;
  document.getElementById('hud').textContent=turn.charAt(0).toUpperCase()+turn.slice(1)+' to move';
  update(); coords(); SND.ui();
}

/* ======================================================
   BOARD TEXT / COORDS
====================================================== */
function txt(t){const canvas=document.createElement("canvas");canvas.width=128;canvas.height=128;const ctx=canvas.getContext("2d");ctx.fillStyle="#ffffff";ctx.font="bold 80px Arial";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(t,80,80);return new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.9),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,side:THREE.DoubleSide}));}
function orientToPlayer(mesh){const bf=new THREE.Vector3(0,0,1).applyQuaternion(pivot.quaternion);const cd=camera.position.clone().sub(pivot.position).normalize();const wp=bf.dot(cd)>0;mesh.rotation.x=-Math.PI/2;mesh.rotation.z=wp?0:Math.PI;}
const cg=new THREE.Group();pivot.add(cg);
function coords(){
  cg.clear();
  const yh=layers[activeZ].position.y+0.08;
  const bf=new THREE.Vector3(0,0,1).applyQuaternion(pivot.quaternion);
  const cd=camera.position.clone().sub(pivot.position).normalize();
  const wp=bf.dot(cd)>0;
  const farZ=wp?-half-1:half+1,rankX=wp?-half-1:half+1;
  for(let i=0;i<8;i++){
    const mi=7-i,file=String.fromCharCode(65+i);
    const l=txt(file);
    l.rotation.x=-Math.PI/2;
    l.rotation.z=wp?0:Math.PI;
    l.position.set(-half+(mi+0.5)*SPACING,yh,farZ);
    cg.add(l);
    const n=txt((i+1).toString());
    n.rotation.x=-Math.PI/2;
    n.rotation.z=wp?0:Math.PI;
    n.position.set(rankX,yh,-half+(i+0.5)*SPACING);
    cg.add(n);
  }
  // Layer number — flat (lying on board) in FLAT mode so it's readable from above;
  // vertical (billboard-style) in all other modes
  const h=txt((activeZ+1).toString());
  if(typeof cameraMode!=='undefined'&&cameraMode===CAMERA_MODES.FLAT){
    h.rotation.x=-Math.PI/2;
    h.rotation.z=wp?0:Math.PI;
    h.position.set(rankX,yh,farZ);
  }else{
    h.rotation.x=0;h.rotation.z=0;
    h.rotation.y=wp?0:Math.PI;
    h.position.set(rankX,layers[activeZ].position.y+0.6,farZ);
  }
  cg.add(h);
}

/* ======================================================
   UI SYSTEM
====================================================== */
function squareName(x,y,z){return `${String.fromCharCode(97+x)}${y+1}-${z+1}`;}
function logMove(piece,from,to,capture=false){const typeMap={knight:"N",king:"K",queen:"Q",rook:"R",bishop:"B"};const entry={number:moveNumber,turn,piece:typeMap[piece.userData.type]||"P",from,to,capture,moveColor:turn};moveLog.push(entry);const panel=document.getElementById("movePanel");const div=document.createElement("div");const prefix=turn==="white"?moveNumber+". ":"   ";const cap=capture?"x":"-";div.textContent=prefix+entry.piece+squareName(from.x,from.y,from.z)+cap+squareName(to.x,to.y,to.z);div.style.cursor="pointer";entry.el=div;const index=moveLog.length-1;div.onclick=()=>{setReviewing(true);reviewIndex=index;loadHistory(index);updateReviewUI();};panel.appendChild(div);panel.scrollTop=panel.scrollHeight;if(turn==="black")moveNumber++;}
function addMoveAnnotation(ann){const e=moveLog[moveLog.length-1];if(e&&e.el)e.el.textContent+=ann;}
function endGame(message){
  document.getElementById("pauseMenu").style.display="none";
  document.getElementById("endText").textContent=message;
  document.getElementById("endMenu").style.display="flex";
  // Steam achievements + rich presence
  if (window.Steam && window.Steam.isAvailable) {
    const isWin = playerColor && message.toLowerCase().includes(playerColor === 'white' ? 'white wins' : 'black wins');
    if (isWin) {
      window.Steam.unlockAchievement('FIRST_WIN');
      if (!botColor) window.Steam.unlockAchievement('ONLINE_WIN');
      else           window.Steam.unlockAchievement('BOT_WIN');
    }
    window.Steam.setRichPresence('steam_display', '#Status_Menu');
    window.Steam.setRichPresence('status', 'In Menu');
  }
}

function boardText(msg, color) {
  const keyMap = { 'CHECKMATE':'checkmate', 'STALEMATE':'stalemate', 'CHECK':'check' };
  if (keyMap[msg]) { showBoardMsg(keyMap[msg]); return; }
  const canvas=document.createElement("canvas"); canvas.width=512; canvas.height=128;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#"+((color||0xffffff).toString(16).padStart(6,"0"));
  ctx.font="800 80px "+(typeof MSG_FONT!=='undefined'?MSG_FONT:'sans-serif'); ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.shadowColor=ctx.fillStyle; ctx.shadowBlur=22; ctx.fillText(msg,256,64);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(8,2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true}));
  mesh.position.set(0,layers[activeZ].position.y+1.5,0); orientToPlayer(mesh); pivot.add(mesh);
  setTimeout(()=>pivot.remove(mesh),3500);
}

function startGameMessage() { showBoardMsg('start'); }

function drawMoveArrow(from,to){
  reviewArrows.forEach(a=>pivot.remove(a)); reviewArrows=[];
  // Lift well above board so arrow can't be occluded by any geometry
  const LIFT = 0.9;
  const start = worldPos(from.x,from.y,from.z); start.y += LIFT;
  const end   = worldPos(to.x,  to.y,  to.z);   end.y   += LIFT;
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  if (len < 0.01) return;
  const headLen   = Math.max(0.55, len * 0.32);
  const headWidth = headLen * 0.60;
  // The last un-retinted gameplay colour: a neon orange chosen to stand out
  // against the old cyan grid, which now lands on a pastel board. The cozy
  // layer publishes window.CZ_ARROWS (js/25_cozy_scene.js); with no override
  // the original neon applies exactly as before, the same arrangement
  // CZ_TV / CZ_GLOW / CZ_BG_ACTIVE already use.
  const _mvCol = (window.CZ_ARROWS && window.CZ_ARROWS.move) || 0xff8800;
  const arrow = new THREE.ArrowHelper(dir.normalize(), start, len, _mvCol, headLen, headWidth);
  // Force render on top of all geometry — never occluded
  arrow.traverse(obj => {
    if (obj.material) {
      obj.material.depthTest  = false;
      obj.material.depthWrite = false;
      obj.renderOrder = 99;
    }
  });
  arrow.renderOrder = 99;
  pivot.add(arrow); reviewArrows.push(arrow);
}
function rebuildCopyButton(){
  const btn=document.getElementById("copyMoves");
  if(btn)btn.onclick=copyMovesToClipboard;
  // Add a "save portable replay" button to the moves-panel header (once per rebuild).
  if(btn && !document.getElementById('movePanelDownload')){
    const dl=document.createElement('button');
    dl.id='movePanelDownload';
    dl.title='Save this game as a portable replay (.html)';
    dl.textContent='⬇';
    dl.style.cssText='background:none;border:1px solid #0a1e30;border-radius:4px;color:#6ab4d8;'+
      'cursor:pointer;font-family:monospace;font-size:12px;padding:2px 8px;margin-right:6px;line-height:1;touch-action:manipulation;';
    btn.parentNode.insertBefore(dl,btn);
    dl.onclick=function(){if(window.CTFExport&&window.CTFExport.download)window.CTFExport.download();};
  }
}
function copyMovesToClipboard() {
  // 3D Chess Notation format:
  // [Event "Aurora Chess"]
  // [White "Player1"] [Black "Player2"]
  // 1. Pe2-e3/1 Pd7-d6/1 2. Qd1-d8/1 ...
  // Squares: file+rank/layer e.g. e3/1 = x=4,y=2,z=0
  const header = [
    '[Event "Aurora Chess"]',
    '[Site "aurora-chess.html"]',
    '[Date "' + new Date().toISOString().slice(0,10) + '"]',
    '[White "White"]',
    '[Black "Black"]',
    '[Result "*"]',
    '',
  ];
  const sq3d = (pos) => {
    const file = String.fromCharCode(97 + pos.x);
    return file + (pos.y+1) + '/' + (pos.z+1);
  };
  let lines = [];
  for (let i = 0; i < moveLog.length; i++) {
    const m = moveLog[i];
    const token = (m.piece||'P') + sq3d(m.from) + (m.capture ? 'x' : '-') + sq3d(m.to);
    if (m.turn === 'white') {
      lines.push(m.number + '. ' + token);
    } else {
      lines[lines.length-1] += ' ' + token;
    }
  }
  const text = header.join('\n') + lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyMoves');
    if (btn) { const orig=btn.innerHTML; btn.innerHTML='✓'; setTimeout(()=>btn.innerHTML=orig,1500); }
  });
}
document.getElementById("copyMoves").onclick=copyMovesToClipboard;

function copyPGN() {
  // PGN algebraic notation with layer suffix e.g. e4z1 (z is 1-indexed)
  const sqPGN = (pos) => String.fromCharCode(97 + pos.x) + (pos.y + 1) + (pos.z > 0 ? 'z' + (pos.z + 1) : '');
  const header = [
    '[Event "Aurora Chess"]',
    '[Site "aurora-chess-v1"]',
    '[Date "' + new Date().toISOString().slice(0,10) + '"]',
    '[White "White"]',
    '[Black "Black"]',
    '[Result "*"]',
    '',
  ];
  let lines = [];
  for (let i = 0; i < moveLog.length; i++) {
    const m = moveLog[i];
    const piece = (m.piece && m.piece !== 'P') ? m.piece : '';
    const token = piece + sqPGN(m.from) + (m.capture ? 'x' : '-') + sqPGN(m.to);
    if (m.turn === 'white') {
      lines.push(m.number + '. ' + token);
    } else {
      lines[lines.length - 1] += ' ' + token;
    }
  }
  const text = header.join('\n') + lines.join('  ');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyPGNBtn');
    if (btn) { const orig = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = orig, 1500); }
  });
}
document.getElementById('copyPGNBtn').onclick = copyPGN;

