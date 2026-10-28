/* ======================================================
   MOVE EXECUTION
====================================================== */
function executeMove(piece,t) {
  clearThreatLines();
  let victim=occ(t.x,t.y,t.z);
  // En passant: remove the captured pawn from its actual square
  if(!victim && t.enPassant) {
    const ep = t.enPassant;
    victim = occ(ep.px, ep.py, ep.pz);
    if(victim) {
      delete boardMap[key(ep.px,ep.py,ep.pz)];
      normalizeMaterial(victim);if(victim.parent)victim.parent.remove(victim);
      const i=pieces.indexOf(victim);if(i!==-1)pieces.splice(i,1);
      SND.capture(); HAP.vib('capture');
      victim = null; // already handled
    }
  }
  if(victim){
    delete boardMap[key(victim.userData.x,victim.userData.y,victim.userData.z)];
    normalizeMaterial(victim);if(victim.parent)victim.parent.remove(victim);
    const i=pieces.indexOf(victim);if(i!==-1)pieces.splice(i,1);
    SND.capture(); HAP.vib('capture');
    halfmoveClock = 0; // reset on capture
  } else {
    if(piece.userData.z!==t.z) { SND.placeLayer(); } else { SND.glide(); }
    HAP.vib('place');
    if(piece.userData.type==='pawn') { halfmoveClock = 0; } else { halfmoveClock++; }
  }
  // Track en passant eligibility
  if(piece.userData.type==='pawn' && (t.doublePushY || t.doublePushZ)) {
    lastDoublePawn = {px:t.x,py:t.y,pz:t.z,color:piece.userData.color,doublePushY:!!t.doublePushY,doublePushZ:!!t.doublePushZ};
  } else {
    lastDoublePawn = null;
  }
  const from={x:piece.userData.x,y:piece.userData.y,z:piece.userData.z};
  delete boardMap[key(from.x,from.y,from.z)];
  piece.userData.x=t.x;piece.userData.y=t.y;piece.userData.z=t.z;
  boardMap[key(t.x,t.y,t.z)]=piece;
  animateMove(piece,from,t);
  showLastMove(from,t);
  normalizeMaterial(piece);
  piece.userData.moved=true;
  if(!reviewing){logMove(piece,from,t,!!victim);history.push({from:{...from},to:{...t}});snapshots.push(JSON.stringify(pieces.map(p=>({type:p.userData.type,color:p.userData.color,x:p.userData.x,y:p.userData.y,z:p.userData.z,moved:p.userData.moved}))));const _miniBar=document.getElementById('moveNumBar');if(_miniBar){_miniBar.style.display='flex';syncMoveNumBar();}}
  const promoted=promotePawn(piece);
  if(!promoted){
    turn=turn==="white"?"black":"white";
    document.getElementById("hud").textContent=turn.charAt(0).toUpperCase()+turn.slice(1)+" to move";
    if(!gameStarted){if(startMessageMesh){pivot.remove(startMessageMesh);startMessageMesh=null;}gameStarted=true;}
    reviewIndex=history.length-1;
    if(!hasLegalMoves(turn)){
      if(isInCheck(turn)){
        boardText("CHECKMATE",0xff4444);
        addMoveAnnotation('#');
        SND.end(turn!==playerColor);
        setTimeout(()=>endGame(turn==="white"?"Black wins by checkmate":"White wins by checkmate"),1200);
      } else {
        boardText("STALEMATE",0xaaaaaa);
        SND.end(false);
        setTimeout(()=>endGame("Draw by stalemate"),1200);
      }
    } else if(isInsufficientMaterial()){
      boardText("DRAW",0xaaaaaa);
      SND.end(false);
      setTimeout(()=>endGame("Draw — insufficient material"),1200);
    } else if(halfmoveClock >= 100){
      boardText("DRAW",0xaaaaaa);
      SND.end(false);
      setTimeout(()=>endGame("Draw by 50-move rule"),1200);
    } else {
      if(isInCheck(turn)){
        boardText("CHECK",0xff4444);
        addMoveAnnotation('+');
        showThreatLines(turn);
        SND.check(); HAP.vib('check');
      }
      if(!reviewing&&turn===botColor){scheduleBotMove(900);}
    }
  }
}

function isInsufficientMaterial() {
  const wPieces = pieces.filter(p=>p.userData.color==='white');
  const bPieces = pieces.filter(p=>p.userData.color==='black');
  const wTypes = wPieces.map(p=>p.userData.type).sort().join(',');
  const bTypes = bPieces.map(p=>p.userData.type).sort().join(',');
  // K vs K
  if(wTypes==='king' && bTypes==='king') return true;
  // K+N vs K or K vs K+N
  if((wTypes==='king,knight' && bTypes==='king')||(wTypes==='king' && bTypes==='king,knight')) return true;
  // K+B vs K or K vs K+B
  if((wTypes==='bishop,king' && bTypes==='king')||(wTypes==='king' && bTypes==='bishop,king')) return true;
  // K+B vs K+B same color bishops
  if(wTypes==='bishop,king' && bTypes==='bishop,king') {
    const wb=wPieces.find(p=>p.userData.type==='bishop');
    const bb=bPieces.find(p=>p.userData.type==='bishop');
    if(wb&&bb&&((wb.userData.x+wb.userData.y+wb.userData.z)%2===((bb.userData.x+bb.userData.y+bb.userData.z)%2))) return true;
  }
  return false;
}

function executeCastle(move,kingPiece){const row=kingPiece.userData.y,layer=kingPiece.userData.z;if(move.castle==="kingside"){const r=occ(7,row,layer);if(r){delete boardMap[key(7,row,layer)];r.position.set(-half+5.5*SPACING,0,-half+(row+0.5)*SPACING);layers[layer].add(r);r.userData.x=5;r.userData.moved=true;boardMap[key(5,row,layer)]=r;}}if(move.castle==="queenside"){const r=occ(0,row,layer);if(r){delete boardMap[key(0,row,layer)];r.position.set(-half+3.5*SPACING,0,-half+(row+0.5)*SPACING);layers[layer].add(r);r.userData.x=3;r.userData.moved=true;boardMap[key(3,row,layer)]=r;}}}

/* ======================================================
   PROMOTION SYSTEM
====================================================== */
function promotePawn(p){if(p.userData.type!=="pawn")return false;const pw=p.userData.color==="white"&&p.userData.y===7;const pb=p.userData.color==="black"&&p.userData.y===0;if(!pw&&!pb)return false;
  // Bot or receiving opponent's move: auto-queen, no UI
  if(p.userData.color===botColor){promotionActive=true;promotionGroup.userData.pawn=p;setTimeout(function(){if(promotionActive)resolvePromotion('queen');},50);return true;}
  // Receiving opponent's promotion via DataChannel: show wait overlay until promotion message arrives
  if(typeof ONLINE!=="undefined"&&ONLINE&&ONLINE._receivingRemoteMove){promotionActive=true;promotionGroup.userData.pawn=p;var _pw=document.getElementById('promotionWait');if(_pw)_pw.style.display='flex';return true;}
  // Local player promotion: show HTML popup
  promotionActive=true;promotionGroup.userData.pawn=p;var _pp=document.getElementById('promotionPopup');if(_pp)_pp.style.display='flex';return true;}
function resolvePromotion(type){var _pp=document.getElementById('promotionPopup');if(_pp)_pp.style.display='none';var _pw=document.getElementById('promotionWait');if(_pw)_pw.style.display='none';const pawn=promotionGroup.userData.pawn;const newPiece=buildPiece(type,pawn.userData.color);newPiece.userData.type=type;layers[pawn.userData.z].add(newPiece);

newPiece.position.set(
  -half + (pawn.userData.x + 0.5) * SPACING,
  0,
  -half + (pawn.userData.y + 0.5) * SPACING
);newPiece.userData.x=pawn.userData.x;newPiece.userData.y=pawn.userData.y;newPiece.userData.z=pawn.userData.z;newPiece.userData.moved=true;pieces.splice(pieces.indexOf(pawn),1);pawn.parent.remove(pawn);pieces.push(newPiece);boardMap[key(newPiece.userData.x,newPiece.userData.y,newPiece.userData.z)]=newPiece;promotionGroup.clear();promotionActive=false;if(!reviewing&&typeof addMoveAnnotation==='function'){var _pm={queen:'Q',rook:'R',bishop:'B',knight:'N'};addMoveAnnotation('='+(_pm[type]||type.charAt(0).toUpperCase()));}if(typeof ONLINE!=="undefined"&&ONLINE&&ONLINE.inMatch&&!ONLINE._syncing&&pawn.userData.color===playerColor){onlineDCSend('promotion',{pieceType:type,x:pawn.userData.x,y:pawn.userData.y,z:pawn.userData.z});}turn=turn==="white"?"black":"white";document.getElementById("hud").textContent=turn.charAt(0).toUpperCase()+turn.slice(1)+" to move";if(!hasLegalMoves(turn)){if(isInCheck(turn)){boardText("CHECKMATE",0xff4444);SND.end(turn!==playerColor);setTimeout(()=>endGame(turn==="white"?"Black wins by checkmate":"White wins by checkmate"),1200);}else{boardText("STALEMATE",0xaaaaaa);SND.end(false);setTimeout(()=>endGame("Draw by stalemate"),1200);}}else{if(isInCheck(turn)){boardText("CHECK",0xff4444);showThreatLines(turn);SND.check();HAP.vib('check');}if(!reviewing&&turn===botColor){scheduleBotMove(900);}}}

/* ======================================================
   BOARD RESET
====================================================== */
function resetBoard(clearMoves=true){clearThreatLines();lastDoublePawn=null;halfmoveClock=0;setReviewing(false);for(const k in boardMap)delete boardMap[k];pieces.forEach(p=>{if(p.parent)p.parent.remove(p);});pieces.length=0;movePlates.forEach(m=>pivot.remove(m));movePlates=[];pulsePlates=[];if(selPlate)pivot.remove(selPlate);selectedPawn=null;lastMoveSquares.forEach(p=>pivot.remove(p));lastMoveSquares=[];reviewArrows.forEach(a=>pivot.remove(a));reviewArrows=[];if(startMessageMesh){pivot.remove(startMessageMesh);startMessageMesh=null;}if(clearMoves){moveLog=[];moveNumber=1;history=[];snapshots=[];document.getElementById("movePanel").innerHTML=`<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button id="copyMoves" class="copyBtn"><div class="copySq1"></div><div class="copySq2"></div></button></div>`;rebuildCopyButton();const _mb=document.getElementById('moveNumBar');if(_mb)_mb.style.display='none';}placeStartingPieces();}
function loadHistory(index){if(index<0||index>=snapshots.length)return;pieces.forEach(p=>{if(p.parent)p.parent.remove(p);});pieces.length=0;for(const k in boardMap)delete boardMap[k];const state=JSON.parse(snapshots[index]);state.forEach(s=>{const p=buildPiece(s.type,s.color);place(p,s.x,s.y,s.z);p.userData.moved=s.moved;});update();const move=history[index];if(move)drawMoveArrow(move.from,move.to);}

/* ======================================================
   INPUT SYSTEM
====================================================== */
const rc=new THREE.Raycaster();
const mv=new THREE.Vector2();
var _lastMoveAt = 0;

renderer.domElement.addEventListener("touchstart",function(e){
  const menus=["mainMenu","modeMenu","botMenu","pauseMenu","endMenu","settingsOverlay","tutorialOverlay","puzzleSelectOverlay","gameModesMenu","arcadeMenu","ctfMenu"];
  if(menus.some(id=>document.getElementById(id).style.display!=="none")) return;
  e.preventDefault();

  if(e.touches.length!==1) return;

  const r=renderer.domElement.getBoundingClientRect();
  mv.x=((e.touches[0].clientX-r.left)/r.width)*2-1;
  mv.y=-((e.touches[0].clientY-r.top)/r.height)*2+1;
  rc.setFromCamera(mv,camera);

  if(promotionActive) return;

  // In review mode: snap to live on any board tap, then let normal interaction proceed
  if(reviewing){ if(typeof _snapToLive==='function')_snapToLive(); return; }

  // Threat vision toggle mode: route taps to threat vision instead of move
  if(window._tvModeActive && typeof window._threatVisionClick === 'function'){
    window._threatVisionClick(mv.x, mv.y); return;
  }

  const hit=rc.intersectObjects(layerPlanes[activeZ]);
  if(!hit.length) return;
  const t=hit[0].object.userData;

  // If no piece selected yet, check if this square has a selectable piece
  if(!selectedPawn) {
    const squarePiece = occ(t.x, t.y, t.z);
    if(squarePiece && squarePiece.userData.z===activeZ &&
       ((!botThinking&&squarePiece.userData.color===turn&&((!botColor&&!ONLINE.inMatch)||squarePiece.userData.color===playerColor))||(botThinking&&botColor&&squarePiece.userData.color===playerColor))){
      if(selectedPawn && selectedPawn!==squarePiece){
        const prevCfg2=selectedPawn.userData.color==='white'?CFG.pieces.white:CFG.pieces.black;
        setOutlineColor(selectedPawn,prevCfg2.outlineColor);
      }
      selectedPawn=squarePiece;
      notifySelectionChanged();
      SND.select(); HAP.vib('select');
      if(selPlate){pivot.remove(selPlate);selPlate=null;}
      const cfg2=squarePiece.userData.color==='white'?CFG.pieces.white:CFG.pieces.black;
      setOutlineColor(squarePiece,cfg2.outlineSelColor);
      selPlate=square(squarePiece.userData.x,squarePiece.userData.y,squarePiece.userData.z,true,cfg2.outlineSelColor,CFG.hl.selection.opacity);
      const legal2=getLegalMoves(squarePiece);
      legalMoves=legal2;
      movePlates.forEach(mp=>pivot.remove(mp));movePlates=[];pulsePlates=[];
      if(CFG.hl.legal.on){legal2.forEach(mv2=>{const plate=square(mv2.x,mv2.y,mv2.z,false,CFG.hl.legal.color,CFG.hl.legal.opacity);movePlates.push(plate);});}
    }
    return;
  }

  const legal=getLegalMoves(selectedPawn);
  const move=legal.find(mv2=>mv2.x===t.x&&mv2.y===t.y&&mv2.z===t.z);
  // Tapping own piece on a square — switch selection
  if(!move) {
    const squarePiece = occ(t.x, t.y, t.z);
    if(squarePiece && squarePiece.userData.color===turn && ((!botColor&&!ONLINE.inMatch)||squarePiece.userData.color===playerColor)){
      const prevCfg3=selectedPawn.userData.color==='white'?CFG.pieces.white:CFG.pieces.black;
      setOutlineColor(selectedPawn,prevCfg3.outlineColor);
      if(selPlate){pivot.remove(selPlate);selPlate=null;}
      movePlates.forEach(mp=>pivot.remove(mp));movePlates=[];pulsePlates=[];
      selectedPawn=squarePiece;
      notifySelectionChanged();
      SND.select();
      const cfg3=squarePiece.userData.color==='white'?CFG.pieces.white:CFG.pieces.black;
      setOutlineColor(squarePiece,cfg3.outlineSelColor);
      selPlate=square(squarePiece.userData.x,squarePiece.userData.y,squarePiece.userData.z,true,cfg3.outlineSelColor,CFG.hl.selection.opacity);
      const legal3=getLegalMoves(squarePiece);
      legalMoves=legal3;
      if(CFG.hl.legal.on){legal3.forEach(mv2=>{const plate=square(mv2.x,mv2.y,mv2.z,false,CFG.hl.legal.color,CFG.hl.legal.opacity);movePlates.push(plate);});}
    }
    return;
  }
  if(!move) return;
  if(botThinking) return; // view-only during bot thinking — don't execute
  var _now = Date.now(); if(_now - _lastMoveAt < 300) return; _lastMoveAt = _now;

  SND.ui();
  if(selectedPawn.userData.type==="king"&&move.castle) executeCastle(move,selectedPawn);
  const prevSelected=selectedPawn;
  selectedPawn=null;
  notifySelectionChanged();
  if(selPlate){pivot.remove(selPlate);selPlate=null;}
  movePlates.forEach(mp=>pivot.remove(mp));movePlates=[];pulsePlates=[];
  const prevCfg=prevSelected.userData.color==='white'?CFG.pieces.white:CFG.pieces.black;
  setOutlineColor(prevSelected,prevCfg.outlineColor);

  executeMove(prevSelected,move);
  fadeHighlight(t.x,t.y,t.z,prevSelected);

  if(!gameStarted){gameStarted=true;}
  document.getElementById("hud").textContent=turn.charAt(0).toUpperCase()+turn.slice(1)+" to move";
},{passive:false});

let px,py,pd;
// 1-finger gesture state
let camSwipeStartY=null, camSwipeStartZ=null;
let _1fAxis=null, _1fStartX=null, _1fStartY=null;
// 2-finger gesture state — only prev center needed; no axis lock
let _2fPrevX=null, _2fPrevY=null;
let _2fLayerStartY=null, _2fLayerStartZ=null;

renderer.domElement.addEventListener("touchmove",function(e){
  e.preventDefault();
  if(e.touches.length===1){
    const tx=e.touches[0].clientX, ty=e.touches[0].clientY;
    // Lock axis on first significant movement so layer-swipe and pan don't bleed into each other
    if(_1fAxis===null && _1fStartX!==null){
      const adx=Math.abs(tx-_1fStartX), ady=Math.abs(ty-_1fStartY);
      if(Math.max(adx,ady)>8) _1fAxis=(adx>ady)?'h':'v';
    }
    if(_1fAxis==='v' && window._panModeActive && typeof window._doBoardPanTouch==='function'){
      // Pan mode: 1-finger vertical drag → raise / lower the board
      if(py!==null) window._doBoardPanTouch(0, ty-py);
    } else if(_1fAxis==='v' && INPUT_CFG.swipeMode==='swapped'){
      // Swapped: 1-finger vertical → rotate board
      if(UI_PREFS.boardRotate && py!==null){
        pivot.rotation.x+=(ty-py)*0.01;
        coords();
      }
    } else if(_1fAxis==='v' && UI_PREFS.swipeLayer){
      // Default: 1-finger vertical → layer change (~50px per step)
      if(camSwipeStartY!==null){
        const delta=camSwipeStartY-ty;
        const newZ=Math.max(0,Math.min(LAYERS-1,camSwipeStartZ+Math.round(delta/50)));
        if(newZ!==activeZ){
          activeZ=newZ; update(); coords();
          document.getElementById("zSlider").value=activeZ;
          SND.layer(activeZ); HAP.vib('layer'); flashLayerIndicator(activeZ);
          camOnLayerChange();
        }
      }
    }
    px=tx; py=ty;
  }
  if(e.touches.length===2){
    const x1=e.touches[0].clientX, y1=e.touches[0].clientY;
    const x2=e.touches[1].clientX, y2=e.touches[1].clientY;
    const cx=(x1+x2)/2, cy=(y1+y2)/2;
    const dist=Math.hypot(x2-x1, y2-y1);
    if(_2fPrevX!==null){
      if(INPUT_CFG.swipeMode==='swapped'){
        // Swapped: 2-finger vertical → layer change, horizontal → ignored for layer
        if(UI_PREFS.swipeLayer && _2fLayerStartY!==null){
          const delta=_2fLayerStartY-cy;
          const newZ=Math.max(0,Math.min(LAYERS-1,_2fLayerStartZ+Math.round(delta/50)));
          if(newZ!==activeZ){
            activeZ=newZ; update(); coords();
            document.getElementById("zSlider").value=activeZ;
            SND.layer(activeZ); HAP.vib('layer'); flashLayerIndicator(activeZ);
            camOnLayerChange();
          }
        }
      } else {
        // Default: 2-finger → rotate board
        if(UI_PREFS.boardRotate){
          pivot.rotation.y+=(cx-_2fPrevX)*0.01;
          pivot.rotation.x+=(cy-_2fPrevY)*0.01;
          coords();
        }
      }
      // Zoom: driven by distance change — geometrically independent
      if(UI_PREFS.pinchZoom && pd && dist>0){
        const ratio=pd/dist;
        if(cameraMode===CAMERA_MODES.FREE){
          camera.position.multiplyScalar(ratio);
        } else {
          const dir=new THREE.Vector3().subVectors(camera.position,_camLookAt);
          dir.multiplyScalar(ratio);
          camera.position.copy(_camLookAt).add(dir);
        }
      }
    }
    _2fPrevX=cx; _2fPrevY=cy;
    pd=dist;
  }
},{passive:false});
renderer.domElement.addEventListener("touchstart",function(e2){
  if(e2.touches.length===1){
    camSwipeStartY=e2.touches[0].clientY; camSwipeStartZ=activeZ;
    _1fAxis=null; _1fStartX=e2.touches[0].clientX; _1fStartY=e2.touches[0].clientY;
    px=e2.touches[0].clientX; py=e2.touches[0].clientY;
  }
  if(e2.touches.length===2){
    const x1=e2.touches[0].clientX, y1=e2.touches[0].clientY;
    const x2=e2.touches[1].clientX, y2=e2.touches[1].clientY;
    _2fPrevX=(x1+x2)/2; _2fPrevY=(y1+y2)/2;
    _2fLayerStartY=_2fPrevY; _2fLayerStartZ=activeZ;
    pd=Math.hypot(x2-x1, y2-y1);
  }
},{passive:true, capture:false});
renderer.domElement.addEventListener("touchend",()=>{
  px=py=pd=null;
  camSwipeStartY=null; camSwipeStartZ=null;
  _1fAxis=null; _1fStartX=null; _1fStartY=null;
  _2fPrevX=null; _2fPrevY=null;
  _2fLayerStartY=null; _2fLayerStartZ=null;
});

