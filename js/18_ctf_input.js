/* ================================================================
   ██████╗████████╗███████╗    MODE
  ██╔════╝╚══██╔══╝██╔════╝
  ██║        ██║   █████╗
  ██║        ██║   ██╔══╝
  ╚██████╗   ██║   ██║
   ╚═════╝   ╚═╝   ╚═╝
  CAPTURE THE FLAG — fully additive module
  Patched into executeMove / hasLegalMoves / endGame checks.
  All changes are guarded by (ctfMode) so standard chess is unaffected.
================================================================ */

/* ── State ── */
var ctfMode = false;

var CTF = {
  // Flag data for each team
  white: { carrier: null, square: {x:4,y:0,z:0}, sprite: null, reset: function(){ CTF.white.square={x:4,y:0,z:0}; } },
  black: { carrier: null, square: {x:4,y:7,z:3}, sprite: null, reset: function(){ CTF.black.square={x:4,y:7,z:3}; } },

  // Respawn queue: [{type, color, respawnOnTurn}]
  respawnQueue: [],
  turnCount: 0,
  RESPAWN_TURNS: 8,
  DELIVERY_LAYERS: [0, 1],

  // Scoring state
  scores: {white: 0, black: 0},
  pointTarget: 1,
  firstMover: 'white',
  increment: 0,

  // Reset flag/board state only (scores survive)
  reset: function() {
    CTF.white.carrier = null;
    CTF.black.carrier = null;
    CTF.white.reset();
    CTF.black.reset();
    CTF.respawnQueue = [];
    CTF.turnCount = 0;
    CTF.removeSprites();
  },

  // Full game reset (called on new game start)
  fullReset: function() {
    CTF.scores = {white: 0, black: 0};
    CTF.firstMover = 'white';
    CTF.reset();
  },

  // Called when a team delivers the flag — handle scoring and round/game end
  scorePoint: function(scorer) {
    CTF.scores[scorer]++;
    var ws = CTF.scores.white, bs = CTF.scores.black;
    arcadeAnnounce('🚩 '+scorer.toUpperCase()+' SCORES!  '+ws+' – '+bs, scorer==='white'?0x00aaff:0xff6600);
    if (typeof SND !== 'undefined' && SND.end) SND.end(false);
    if (ws >= CTF.pointTarget || bs >= CTF.pointTarget) {
      var winMsg = (scorer.charAt(0).toUpperCase()+scorer.slice(1))+' wins '+ws+' – '+bs+'!';
      setTimeout(function(){ endGame(winMsg); }, 800);
      return;
    }
    setTimeout(function(){ CTF.roundReset(); }, 1800);
  },

  _isRoundReset: false,

  // Reset board for next round, cycle first-mover, keep scores
  roundReset: function() {
    var savedScores = {white: CTF.scores.white, black: CTF.scores.black};
    var savedTarget  = CTF.pointTarget;
    var savedInc     = CTF.increment;
    CTF.firstMover   = (CTF.firstMover === 'white' ? 'black' : 'white');
    var nextFirst    = CTF.firstMover;
    CTF._isRoundReset = true;
    startLocalGame();
    CTF._isRoundReset = false;
    CTF.scores      = savedScores;
    CTF.pointTarget = savedTarget;
    CTF.increment   = savedInc;
    CTF.firstMover  = nextFirst;
    turn = nextFirst;
    if (typeof updateClockDisplay === 'function') updateClockDisplay();
    setTimeout(function(){
      CTF.refreshSprites();
      updateCTFHud();
      arcadeAnnounce(nextFirst.toUpperCase()+' MOVES FIRST THIS ROUND', nextFirst==='white'?0x88aaff:0xff8844);
    }, 350);
  },

  // Called when a player's clock hits zero in CTF
  handleTimeExpiry: function(color) {
    var ws = CTF.scores.white, bs = CTF.scores.black;
    var winner, msg;
    if (ws > bs)      { winner='white'; msg='White wins '+ws+' – '+bs+' ('+color+' ran out of time)'; }
    else if (bs > ws) { winner='black'; msg='Black wins '+bs+' – '+ws+' ('+color+' ran out of time)'; }
    else {
      winner = (color==='white'?'black':'white');
      msg = winner.charAt(0).toUpperCase()+winner.slice(1)+' wins on time  ('+ws+' – '+bs+')';
    }
    endGame(msg);
  },

  removeSprites: function() {
    ['white','black'].forEach(function(team) {
      var sp = CTF[team].sprite;
      if (sp) { if (sp.parent) sp.parent.remove(sp); CTF[team].sprite = null; }
    });
  },

  // Place the flag banner: parented to carrier piece (follows animation) or to pivot at rest
  updateSprite: function(team) {
    var fd = CTF[team];
    // Detach old banner from wherever it lives
    if (fd.sprite) {
      if (fd.sprite.parent) fd.sprite.parent.remove(fd.sprite);
      fd.sprite = null;
    }

    var banner = _buildCTFBanner(team);

    if (fd.carrier) {
      // Parent directly to carrier — sits at ground level, follows every animation automatically
      banner.position.set(0, 0, 0);
      fd.carrier.add(banner);
    } else {
      // Resting: add to the layer like a regular piece, sitting at ground level
      var sq = fd.square;
      banner.position.set(-half + (sq.x + 0.5) * SPACING, 0, -half + (sq.y + 0.5) * SPACING);
      layers[sq.z].add(banner);
    }

    fd.sprite = banner;
  },

  // Update both flag banners
  refreshSprites: function() {
    if (!ctfMode) return;
    CTF.updateSprite('white');
    CTF.updateSprite('black');
  },

  // Find closest free square to (cx,cy,cz), Chebyshev distance outward
  closestFreeSquare: function(cx, cy, cz, excludePiece) {
    for (var dist = 1; dist <= 7; dist++) {
      for (var dx = -dist; dx <= dist; dx++) {
        for (var dy = -dist; dy <= dist; dy++) {
          for (var dz = -dist; dz <= dist; dz++) {
            if (Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz)) !== dist) continue;
            var nx=cx+dx, ny=cy+dy, nz=cz+dz;
            if (nx<0||nx>7||ny<0||ny>7||nz<0||nz>=LAYERS) continue;
            var occupant = occ(nx,ny,nz);
            if (!occupant || occupant === excludePiece) return {x:nx,y:ny,z:nz};
          }
        }
      }
    }
    return null;
  },

  // Tick respawn queue — called after each move
  tickRespawns: function() {
    CTF.turnCount++;
    var toSpawn = CTF.respawnQueue.filter(function(r){ return CTF.turnCount >= r.respawnOnTurn; });
    CTF.respawnQueue = CTF.respawnQueue.filter(function(r){ return CTF.turnCount < r.respawnOnTurn; });
    toSpawn.forEach(function(r) {
      // Find the starting square for this piece type
      var sx = r.startX, sy = r.startY, sz = r.startZ;
      // If starting square is occupied, find nearest free
      if (occ(sx,sy,sz)) {
        var free = CTF.closestFreeSquare(sx,sy,sz,null);
        if (!free) return; // no room — defer one more turn
        sx=free.x; sy=free.y; sz=free.z;
        CTF.respawnQueue.push({type:r.type,color:r.color,startX:r.startX,startY:r.startY,startZ:r.startZ,respawnOnTurn:CTF.turnCount+1});
        return;
      }
      // Recreate the piece
      var newP;
      if (!r.type || r.type === 'king') return; // don't respawn kings
      newP = buildPiece(r.type, r.color);
      place(newP, sx, sy, sz);
      newP.userData.moved = true;
      arcadeAnnounce('♻ '+r.color.toUpperCase()+' '+r.type.toUpperCase()+' RESPAWNED!', r.color==='white'?0x88aaff:0xff8844);
      arcadeLogEntry('['+r.type.toUpperCase()+' RESPAWNED at '+squareName(sx,sy,sz)+']', r.color==='white'?'#88aaff':'#ff8844');
    });
  },

  // Add increment seconds to the player who just moved
  _addIncrement: function(movedColor) {
    if (!CTF.increment || !timeEnabled || typeof timers === 'undefined') return;
    timers[movedColor] = Math.min(timers[movedColor] + CTF.increment, 99*60);
    if (typeof updateClockDisplay === 'function') updateClockDisplay();
  },

  // Check win condition after each move
  checkWin: function() {
    // White wins by delivering black's flag to WHITE's home row (Y=0)
    if (CTF.black.carrier && CTF.black.carrier.userData.color === 'white') {
      var c = CTF.black.carrier.userData;
      if (c.y === 0 && CTF.DELIVERY_LAYERS.indexOf(c.z) !== -1) {
        return 'white';
      }
    }
    // Black wins by delivering white's flag to BLACK's home row (Y=7)
    if (CTF.white.carrier && CTF.white.carrier.userData.color === 'black') {
      var c2 = CTF.white.carrier.userData;
      if (c2.y === 7 && CTF.DELIVERY_LAYERS.indexOf(c2.z) !== -1) {
        return 'black';
      }
    }
    return null;
  }
};

/* ── CTF GLB banner builder ── */
var _ctfBannerTemplate = null; // cloned from loaded GLB

(function _loadCTFBannerGLB() {
  if (typeof THREE === 'undefined' || !THREE.GLTFLoader) return;
  var loader = new THREE.GLTFLoader();
  fetch('chess-banner.glb')
    .then(function(r) { return r.arrayBuffer(); })
    .then(function(buf) {
      loader.parse(buf, '', function(gltf) {
        var scene = gltf.scene;
        // Match piece height (same as bishop: 0.82), bottom at local y=0
        var box = new THREE.Box3().setFromObject(scene);
        var h = box.max.y - box.min.y;
        if (h > 0.001) {
          var s = 0.82 / h;
          scene.scale.setScalar(s);
          scene.position.y = -box.min.y * s;
        }
        // Face the board (same orientation as other pieces)
        scene.rotation.y = Math.PI / 2;
        _ctfBannerTemplate = scene;
        if (ctfMode) CTF.refreshSprites();
      }, function(err) {
        console.warn('[CTF] Banner GLB parse failed:', err);
      });
    })
    .catch(function(err) { console.warn('[CTF] Banner GLB fetch failed:', err); });
})();

function _buildCTFBanner(team) {
  var teamColor = team === 'white' ? 0x00aaff : 0xff6600;

  if (_ctfBannerTemplate) {
    var banner = _ctfBannerTemplate.clone(true);
    banner.traverse(function(obj) {
      if (!obj.isMesh) return;
      obj.material = obj.material.clone();
      obj.material.color.setHex(teamColor);
      obj.material.emissive = new THREE.Color(teamColor);
      obj.material.emissiveIntensity = 0.2;
    });
    banner.userData.isCTFBanner = true;
    return banner;
  }

  // Fallback: canvas sprite
  var c = document.createElement('canvas'); c.width=32; c.height=32;
  var ctx = c.getContext('2d');
  ctx.strokeStyle = team==='white' ? '#aaaaff' : '#ffaa44';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(8,4); ctx.lineTo(8,28); ctx.stroke();
  ctx.fillStyle = team==='white' ? '#00aaff' : '#ff6600';
  ctx.beginPath(); ctx.moveTo(10,5); ctx.lineTo(26,12); ctx.lineTo(10,19); ctx.closePath(); ctx.fill();
  var tex = new THREE.CanvasTexture(c);
  var mat = new THREE.SpriteMaterial({ map:tex, transparent:true, opacity:0.95, depthWrite:false });
  var sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.55, 0.55, 1);
  var g = new THREE.Group(); g.add(sprite);
  g.userData.isCTFBanner = true;
  return g;
}

/* ── CTF banner: no animation needed — resting banners sit still on the layer,
   carried banners are children of the carrier piece and follow it automatically ── */

/* ── Patch executeMove for CTF logic ── */
var _ctfBaseExecMove = executeMove;
executeMove = function(piece, t) {
  if (!ctfMode) { _ctfBaseExecMove.call(this, piece, t); return; }

  var movingColor = piece.userData.color;
  var oppColor    = movingColor === 'white' ? 'black' : 'white';
  var fromX = piece.userData.x, fromY = piece.userData.y, fromZ = piece.userData.z;
  var toX = t.x, toY = t.y, toZ = t.z;

  // What's at the destination?
  var destPiece = occ(toX, toY, toZ);

  // ── Case 1: moving piece lands on opponent's flag resting square (no carrier) ──
  var oppFlag = CTF[oppColor];
  if (!oppFlag.carrier && oppFlag.square.x===toX && oppFlag.square.y===toY && oppFlag.square.z===toZ) {
    // Pick up flag — execute move first then assign carrier
    _ctfBaseExecMove.call(this, piece, t);
    oppFlag.carrier = piece;
    arcadeAnnounce('🚩 '+movingColor.toUpperCase()+' PICKED UP THE FLAG!', movingColor==='white'?0x00aaff:0xff6600);
    arcadeLogEntry('[FLAG CAPTURED by '+movingColor+']', movingColor==='white'?'#00aaff':'#ff6600');
    CTF.refreshSprites();
    // Queue respawn of captured piece if there was one at dest (base move handled capture)
    if (destPiece && destPiece !== piece) {
      CTF.respawnQueue.push({type:destPiece.userData.type,color:destPiece.userData.color,startX:destPiece.userData.x,startY:destPiece.userData.y,startZ:destPiece.userData.z,respawnOnTurn:CTF.turnCount+CTF.RESPAWN_TURNS});
    }
    CTF.tickRespawns();
    CTF._addIncrement(movingColor);
    var winner = CTF.checkWin();
    if (winner) { setTimeout(function(){ CTF.scorePoint(winner); }, 400); }
    return;
  }

  // ── Case 2: moving piece captures the opponent's flag CARRIER ──
  var ownFlag = CTF[movingColor];
  if (oppFlag.carrier && destPiece === oppFlag.carrier) {
    if (oppFlag.carrier.userData.color === movingColor) {
      // 2a: Own piece captures own flag carrier → TRANSFER
      var oldCarrier = oppFlag.carrier;
      var freeSquare = CTF.closestFreeSquare(oldCarrier.userData.x, oldCarrier.userData.y, oldCarrier.userData.z, piece);
      _ctfBaseExecMove.call(this, piece, t);
      oppFlag.carrier = piece;
      if (freeSquare && pieces.indexOf(oldCarrier) !== -1) {
        var fromOld = {x:oldCarrier.userData.x,y:oldCarrier.userData.y,z:oldCarrier.userData.z};
        delete boardMap[key(fromOld.x,fromOld.y,fromOld.z)];
        oldCarrier.userData.x=freeSquare.x; oldCarrier.userData.y=freeSquare.y; oldCarrier.userData.z=freeSquare.z;
        boardMap[key(freeSquare.x,freeSquare.y,freeSquare.z)]=oldCarrier;
        layers[freeSquare.z].add(oldCarrier);
        oldCarrier.position.set(-half+(freeSquare.x+0.5)*SPACING,0,-half+(freeSquare.y+0.5)*SPACING);
      }
      arcadeAnnounce('🔄 FLAG TRANSFERRED!', 0xffaa00);
    } else {
      // 2b: Enemy piece captures enemy flag carrier → enemy RECAPTURES their flag
      var captured = oppFlag.carrier;
      _ctfBaseExecMove.call(this, piece, t);
      oppFlag.carrier = null;
      oppFlag.reset();
      CTF.respawnQueue.push({type:captured.userData.type,color:captured.userData.color,startX:captured.userData.x,startY:captured.userData.y,startZ:captured.userData.z,respawnOnTurn:CTF.turnCount+CTF.RESPAWN_TURNS});
      arcadeAnnounce('🛡 FLAG RECOVERED! Returns to start!', oppColor==='white'?0x00aaff:0xff6600);
      arcadeLogEntry('[FLAG RETURNED]', oppColor==='white'?'#00aaff':'#ff6600');
    }
    CTF.refreshSprites();
    CTF.tickRespawns();
    CTF._addIncrement(movingColor);
    var winner2a = CTF.checkWin();
    if (winner2a) { setTimeout(function(){ CTF.scorePoint(winner2a); }, 400); }
    return;
  }

  // ── Case 3: capturing a piece that carries OUR OWN flag → recover flag ──
  if (ownFlag.carrier && destPiece === ownFlag.carrier) {
    var captured2 = ownFlag.carrier;
    _ctfBaseExecMove.call(this, piece, t);
    ownFlag.carrier = null;
    ownFlag.reset();
    // Queue respawn of the killed carrier piece
    if (captured2 && pieces.indexOf(captured2) === -1) {
      CTF.respawnQueue.push({type:captured2.userData.type,color:captured2.userData.color,startX:captured2.userData.x,startY:captured2.userData.y,startZ:captured2.userData.z,respawnOnTurn:CTF.turnCount+CTF.RESPAWN_TURNS});
    }
    arcadeAnnounce('🛡 FLAG RECOVERED! Returns to start!', movingColor==='white'?0x00aaff:0xff6600);
    arcadeLogEntry('[FLAG RETURNED]', movingColor==='white'?'#00aaff':'#ff6600');
    CTF.refreshSprites();
    CTF.tickRespawns();
    CTF._addIncrement(movingColor);
    return;
  }

  // ── Case 4: normal move ──
  _ctfBaseExecMove.call(this, piece, t);
  if (destPiece && pieces.indexOf(destPiece) === -1) {
    CTF.respawnQueue.push({type:destPiece.userData.type,color:destPiece.userData.color,startX:destPiece.userData.x,startY:destPiece.userData.y,startZ:destPiece.userData.z,respawnOnTurn:CTF.turnCount+CTF.RESPAWN_TURNS});
  }
  if (oppFlag.carrier === piece) {
    arcadeAnnounce('🏃 FLAG CARRIER MOVING!', movingColor==='white'?0x00aaff:0xff6600);
  }
  CTF.tickRespawns();
  CTF.refreshSprites();
  CTF._addIncrement(movingColor);

  var winner2 = CTF.checkWin();
  if (winner2) { setTimeout(function(){ CTF.scorePoint(winner2); }, 400); }
};

/* ── Patch resetBoard for CTF cleanup ── */
var _ctfBaseReset = resetBoard;
resetBoard = function(c) {
  _ctfBaseReset(c);
  // Always purge sprites and carrier state so they don't bleed into other modes
  CTF.reset();
  ctfHudEl.style.display = 'none';
  if (ctfMode) {
    // Place flag sprites after pieces settle
    setTimeout(function(){ CTF.refreshSprites(); }, 200);
    setTimeout(function(){ updateCTFHud(); }, 250);
  }
};

/* ── Patch startLocalGame for CTF board setup ── */
var _ctfBaseStartLocal = startLocalGame;
startLocalGame = function() {
  _ctfBaseStartLocal();
  if (!ctfMode) return;
  if (CTF._isRoundReset) { CTF.reset(); } else { CTF.fullReset(); }
  // Remove kings from board — CTF has no king
  var kings = pieces.filter(function(p){ return p.userData.type==='king'; });
  kings.forEach(function(k){
    if (k.parent) k.parent.remove(k);
    delete boardMap[key(k.userData.x,k.userData.y,k.userData.z)];
    var i = pieces.indexOf(k); if (i!==-1) pieces.splice(i,1);
  });
  // Flag sprites
  setTimeout(function(){ CTF.refreshSprites(); }, 300);
  // Update HUD
  document.getElementById('hud').textContent = '🚩 CAPTURE THE FLAG';
};

/* ── Patch hasLegalMoves: in CTF always return true (no stalemate/checkmate) ── */
var _ctfBaseHasLegal = hasLegalMoves;
hasLegalMoves = function(color) {
  if (ctfMode) return true; // no win by stalemate in CTF
  return _ctfBaseHasLegal(color);
};

/* ── Patch isInCheck: in CTF no kings so always false ── */
var _ctfBaseInCheck = isInCheck;
isInCheck = function(color) {
  if (ctfMode) return false;
  return _ctfBaseInCheck(color);
};

/* ── CTF HUD overlay — shows flag status ── */
var ctfHudEl = (function() {
  var el = document.createElement('div');
  el.id = 'ctfHud';
  el.style.cssText = 'position:fixed;top:calc(44px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);'
    +'z-index:21;font-family:monospace;font-size:10px;letter-spacing:1px;'
    +'background:rgba(0,0,0,0.75);padding:3px 12px;border:1px solid #333;'
    +'display:none;white-space:nowrap;pointer-events:none;';
  document.body.appendChild(el);
  return el;
})();

function updateCTFHud() {
  if (!ctfMode) { ctfHudEl.style.display='none'; return; }
  ctfHudEl.style.display = 'block';
  var wStatus = CTF.black.carrier
    ? (CTF.black.carrier.userData.color==='white' ? '🏃' : '⚠')
    : '🏠';
  var bStatus = CTF.white.carrier
    ? (CTF.white.carrier.userData.color==='black' ? '🏃' : '⚠')
    : '🏠';
  var target = CTF.pointTarget > 1 ? ' /'+CTF.pointTarget : '';
  ctfHudEl.textContent = '⬜ '+CTF.scores.white+target+' '+wStatus+'  ·  ⬛ '+CTF.scores.black+target+' '+bStatus;
}

/* ── Extend executeMove to also refresh CTF HUD after every move ── */
var _ctfPostHud = executeMove;
executeMove = function(piece, t) {
  _ctfPostHud.call(this, piece, t);
  if (ctfMode) updateCTFHud();
};

/* ── Also hide CTF HUD when resetting ── */
var _ctfHudResetBase = resetBoard;
resetBoard = function(c) {
  _ctfHudResetBase(c);
  ctfHudEl.style.display = 'none';
};

/* ── Patch startPuzzle: force ctfMode off before entering puzzle mode.
   Without this, CTF patches to hasLegalMoves/isInCheck remain active and
   break checkmate detection, and flag sprites persist on the board. ── */
(function() {
  var _ctfBasePuzzle = typeof startPuzzle !== 'undefined' ? startPuzzle : null;
  if (!_ctfBasePuzzle) return;
  startPuzzle = function(index, tutKey) {
    if (ctfMode) {
      ctfMode = false;
      CTF.reset();
      ctfHudEl.style.display = 'none';
    }
    _ctfBasePuzzle(index, tutKey);
  };
})();


/* ================================================================
   PC INPUT SYSTEM
   - LMB: select piece / execute move (mirrors touchstart logic)
   - RMB hold + drag: rotate board (FREE mode only)
   - Mouse wheel: scroll layer (1 step per notch)
   - Keys 1-4: jump to layer N directly
   - Arrow Up/Down: layer +1 / -1
   - Escape: deselect / open pause menu
   - Tab (hold): show all-layers ghost overlay
   - R: rotate board 180°
   - M: toggle move list
   - V: cycle camera mode
================================================================ */

(function initPCInput() {

  /* ── helpers: shared with touchstart ── */
  function menuOpen() {
    var menus = ["mainMenu","modeMenu","botMenu","pauseMenu","endMenu",
                 "settingsOverlay","tutorialOverlay","puzzleSelectOverlay",
                 "gameModesMenu","arcadeMenu","ctfMenu"];
    return menus.some(function(id) {
      var el = document.getElementById(id);
      return el && el.style.display !== 'none';
    });
  }

  function screenToNDC(clientX, clientY) {
    var r = renderer.domElement.getBoundingClientRect();
    return {
      x:  ((clientX - r.left) / r.width)  * 2 - 1,
      y: -((clientY - r.top)  / r.height) * 2 + 1
    };
  }

  function raycastPieces(ndcX, ndcY) {
    mv.x = ndcX; mv.y = ndcY;
    rc.setFromCamera(mv, camera);
    var hits = rc.intersectObjects(pieces, true);
    for (var i = 0; i < hits.length; i++) {
      var root = findPieceRoot(hits[i].object);
      if (root) return root;
    }
    return null;
  }

  function raycastSquare(ndcX, ndcY) {
    mv.x = ndcX; mv.y = ndcY;
    rc.setFromCamera(mv, camera);
    var hits = rc.intersectObjects(layerPlanes[activeZ]);
    return hits.length ? hits[0].object.userData : null;
  }

  function raycastPromotion(ndcX, ndcY) {
    mv.x = ndcX; mv.y = ndcY;
    rc.setFromCamera(mv, camera);
    var hits = rc.intersectObjects(promotionGroup.children, true);
    for (var i = 0; i < hits.length; i++) {
      var obj = hits[i].object;
      while (obj) { if (obj.userData.promotionChoice) return obj; obj = obj.parent; }
    }
    return null;
  }

  function selectPiece(piece) {
    if (selectedPawn && selectedPawn !== piece) {
      var prevCfg = selectedPawn.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
      setOutlineColor(selectedPawn, prevCfg.outlineColor);
    }
    selectedPawn = piece;
    notifySelectionChanged();
    SND.select();
    if (selPlate) { pivot.remove(selPlate); selPlate = null; }
    var cfg = piece.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
    setOutlineColor(piece, cfg.outlineSelColor);
    selPlate = square(piece.userData.x, piece.userData.y, piece.userData.z, true, cfg.outlineSelColor, CFG.hl.selection.opacity);
    var legal = getLegalMoves(piece);
    legalMoves = legal;
    movePlates.forEach(function(mp) { pivot.remove(mp); });
    movePlates = []; pulsePlates = [];
    if (CFG.hl.legal.on) {
      legal.forEach(function(mv2) {
        var plate = square(mv2.x, mv2.y, mv2.z, false, CFG.hl.legal.color, CFG.hl.legal.opacity);
        movePlates.push(plate);
      });
    }
  }

  function clearSelection() {
    if (selectedPawn) {
      var prevCfg = selectedPawn.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
      setOutlineColor(selectedPawn, prevCfg.outlineColor);
      selectedPawn = null;
    }
    notifySelectionChanged();
    movePlates.forEach(function(mp) { pivot.remove(mp); });
    movePlates = []; pulsePlates = [];
    if (selPlate) { pivot.remove(selPlate); selPlate = null; }
  }

  // Collect all layer hit planes into a flat array for multi-layer raycasting
  function _allLayerPlanes() {
    var a = [];
    for (var _z = 0; _z < LAYERS; _z++) {
      if (!layerPlanes[_z]) continue;
      for (var _p = 0; _p < layerPlanes[_z].length; _p++) a.push(layerPlanes[_z][_p]);
    }
    return a;
  }

  // Find and switch to the first non-active layer hit by this ray.
  // After switching, tries to select a friendly piece at the hit square.
  // Returns true if a layer switch was triggered.
  function _autoJumpToLayer(ndcX, ndcY) {
    if (botThinking) return false;
    mv.x = ndcX; mv.y = ndcY;
    rc.setFromCamera(mv, camera);
    var _hits = rc.intersectObjects(_allLayerPlanes());
    for (var _hi = 0; _hi < _hits.length; _hi++) {
      var _hd = _hits[_hi].object.userData;
      if (_hd.z === activeZ) continue;
      var _tz = _hd.z; var _hx = _hd.x; var _hy = _hd.y;
      clearSelection();
      animLayerCrawl(activeZ, _tz, 200, function() {
        activeZ = _tz;
        var sl = document.getElementById('zSlider'); if (sl) sl.value = activeZ;
        update(); coords(); camOnLayerChange();
        var sp = occ(_hx, _hy, _tz);
        if (sp && sp.userData.color === turn &&
            ((!botColor && typeof ONLINE !== 'undefined' && !ONLINE.inMatch) || sp.userData.color === playerColor)) {
          selectPiece(sp);
        }
      });
      return true;
    }
    return false;
  }

  // Raycast all layer planes, find the first non-activeZ legal move, execute cross-layer switch.
  // Returns true if a cross-layer move was found and executed.
  function _execCrossLayer(ndcX, ndcY) {
    if (!selectedPawn) return false;
    var legal2c = getLegalMoves(selectedPawn);
    mv.x = ndcX; mv.y = ndcY;
    rc.setFromCamera(mv, camera);
    var _hits = rc.intersectObjects(_allLayerPlanes());
    for (var _hi = 0; _hi < _hits.length; _hi++) {
      var _hd = _hits[_hi].object.userData;
      if (_hd.z === activeZ) continue;
      var _cm = legal2c.find(function(m2) { return m2.x === _hd.x && m2.y === _hd.y && m2.z === _hd.z; });
      if (_cm) {
        var _ps = selectedPawn; var _m = _cm;
        clearSelection();
        animLayerCrawl(activeZ, _m.z, 200, function() {
          activeZ = _m.z;
          var sl = document.getElementById('zSlider'); if (sl) sl.value = activeZ;
          update(); coords(); camOnLayerChange();
          if (_ps.userData.type === 'king' && _m.castle) executeCastle(_m, _ps);
          executeMove(_ps, _m);
          fadeHighlight(_m.x, _m.y, _m.z, _ps);
          if (!gameStarted) gameStarted = true;
          document.getElementById('hud').textContent = turn.charAt(0).toUpperCase() + turn.slice(1) + ' to move';
        });
        return true;
      }
    }
    return false;
  }

  function executeClick(ndcX, ndcY) {
    if (!gameStarted && renderer.domElement.style.pointerEvents === 'none') return;
    if (reviewing) { _snapToLive(); return; }
    // Online: block all interaction when it's the opponent's turn
    if (typeof ONLINE !== 'undefined' && ONLINE.inMatch && turn !== ONLINE.myColor) return;

    // Promotion picking — blocked during bot thinking
    if (promotionActive) {
      if (botThinking) return;
      var chosen = raycastPromotion(ndcX, ndcY);
      if (chosen) resolvePromotion(chosen.userData.promotionChoice);
      return;
    }

    // Selection and moves only via board square
    var sq = raycastSquare(ndcX, ndcY);
    if (!sq) {
      if (!botThinking && typeof UI_PREFS !== 'undefined' && UI_PREFS.autoLayerSwitch) {
        if (selectedPawn && _execCrossLayer(ndcX, ndcY)) return;
        if (_autoJumpToLayer(ndcX, ndcY)) return;
      }
      if (!botThinking) clearSelection();
      return;
    }

    if (!selectedPawn) {
      // Maybe a friendly piece is on this square but wasn't directly hit
      var squarePiece = occ(sq.x, sq.y, sq.z);
      var _sqNormal = squarePiece && !botThinking && squarePiece.userData.z === activeZ &&
        squarePiece.userData.color === turn && ((!botColor && !ONLINE.inMatch) || squarePiece.userData.color === playerColor);
      var _sqViewOnly = botThinking && botColor && squarePiece && squarePiece.userData.z === activeZ &&
        squarePiece.userData.color === playerColor;
      if (_sqNormal || _sqViewOnly) selectPiece(squarePiece);
      return;
    }

    // Have a selected piece — block move execution during bot thinking (view-only)
    if (botThinking) return;

    // Try to move
    var legal2 = getLegalMoves(selectedPawn);
    var move2 = legal2.find(function(mv2) { return mv2.x === sq.x && mv2.y === sq.y && mv2.z === sq.z; });

    if (!move2) {
      if (typeof UI_PREFS !== 'undefined' && UI_PREFS.autoLayerSwitch) {
        if (_execCrossLayer(ndcX, ndcY)) return;
        if (_autoJumpToLayer(ndcX, ndcY)) return;
      }
      // Clicked empty square or non-move square — check if own piece is there to switch
      var sp2 = occ(sq.x, sq.y, sq.z);
      if (sp2 && sp2.userData.color === turn && ((!botColor && !ONLINE.inMatch) || sp2.userData.color === playerColor)) {
        selectPiece(sp2);
      } else {
        clearSelection();
      }
      return;
    }

    // Execute the move
    var prevSel = selectedPawn;
    clearSelection();
    if (prevSel.userData.type === 'king' && move2.castle) executeCastle(move2, prevSel);
    executeMove(prevSel, move2);
    fadeHighlight(move2.x, move2.y, move2.z, prevSel);
    if (!gameStarted) gameStarted = true;
    document.getElementById('hud').textContent = turn.charAt(0).toUpperCase() + turn.slice(1) + ' to move';
  }

  /* ── LMB drag-and-drop piece movement ── */
  var _dnd = { down:false, piece:null, dragging:false, ghost:null, ox:0, oy:0, handled:false };

  renderer.domElement.addEventListener('mousedown', function(e) {
    if (e.button !== 0 || menuOpen()) return;
    _dnd.down = true; _dnd.ox = e.clientX; _dnd.oy = e.clientY;
    _dnd.dragging = false; _dnd.handled = false;
    var ndc = screenToNDC(e.clientX, e.clientY);
    var hp = raycastPieces(ndc.x, ndc.y);
    var ok = hp && !botThinking && hp.userData.z === activeZ && hp.userData.color === turn &&
             ((!botColor && !ONLINE.inMatch) || hp.userData.color === playerColor);
    _dnd.piece = ok ? hp : null; // drag-and-drop only when not bot-thinking
  });

  window.addEventListener('mousemove', function(e) {
    if (!_dnd.down || !_dnd.piece) return;
    var dx = e.clientX - _dnd.ox, dy = e.clientY - _dnd.oy;
    if (!_dnd.dragging && Math.sqrt(dx*dx + dy*dy) > 5) {
      _dnd.dragging = true;
      if (selectedPawn !== _dnd.piece) selectPiece(_dnd.piece);
      _dnd.ghost = document.createElement('div');
      _dnd.ghost.style.cssText = 'position:fixed;pointer-events:none;width:42px;height:42px;border-radius:50%;background:rgba(155,89,182,0.35);border:2px solid rgba(206,147,216,0.8);transform:translate(-50%,-50%);z-index:999;box-shadow:0 0 12px rgba(206,147,216,0.6);';
      document.body.appendChild(_dnd.ghost);
    }
    if (_dnd.dragging && _dnd.ghost) {
      _dnd.ghost.style.left = e.clientX + 'px';
      _dnd.ghost.style.top  = e.clientY + 'px';
    }
  });

  window.addEventListener('mouseup', function(e) {
    if (e.button !== 0) return;
    if (_dnd.dragging && _dnd.piece && !reviewing && !botThinking && selectedPawn === _dnd.piece) {
      var ndc  = screenToNDC(e.clientX, e.clientY);
      var sq   = raycastSquare(ndc.x, ndc.y);
      var legal = getLegalMoves(_dnd.piece);
      var move = sq ? legal.find(function(mv) { return mv.x===sq.x && mv.y===sq.y && mv.z===sq.z; }) : null;
      if (!move) {
        var hp2 = raycastPieces(ndc.x, ndc.y);
        if (hp2) move = legal.find(function(mv) { return mv.x===hp2.userData.x && mv.y===hp2.userData.y && mv.z===hp2.userData.z; });
      }
      if (move) {
        var dp = _dnd.piece;
        clearSelection();
        if (dp.userData.type === 'king' && move.castle) executeCastle(move, dp);
        executeMove(dp, move);
        fadeHighlight(move.x, move.y, move.z, dp);
        if (!gameStarted) gameStarted = true;
        document.getElementById('hud').textContent = turn.charAt(0).toUpperCase() + turn.slice(1) + ' to move';
        _dnd.handled = true;
      }
    }
    if (_dnd.ghost) { document.body.removeChild(_dnd.ghost); _dnd.ghost = null; }
    _dnd.down = false; _dnd.dragging = false; _dnd.piece = null;
  });

  /* ── LMB click ── */
  renderer.domElement.addEventListener('click', function(e) {
    if (menuOpen()) return;
    if (e.button !== 0) return;
    if (_dnd.handled) { _dnd.handled = false; return; }
    if (window.gpCursor) { window.gpCursor.kbActive = false; }
    var ndc = screenToNDC(e.clientX, e.clientY);
    // Shift+click OR toggle-mode tap → show threat vision instead of moving
    if ((e.shiftKey || window._tvModeActive) && typeof window._threatVisionClick === 'function') {
      window._threatVisionClick(ndc.x, ndc.y); return;
    }
    // Normal click clears threat vision (unless always-on or toggle mode)
    if (!e.shiftKey && !window._tvModeActive && typeof window._clearThreatVision === 'function') {
      if (typeof UI_PREFS === 'undefined' || !UI_PREFS.threatVisionAlways) {
        window._clearThreatVision();
      }
    }
    executeClick(ndc.x, ndc.y);
  });

  /* ── RMB hold + drag: rotate board ── */
  var _rmbDown = false;
  var _rmbLastX = 0, _rmbLastY = 0;

  renderer.domElement.addEventListener('mousedown', function(e) {
    if (e.button === 2) {
      _rmbDown = true;
      _rmbLastX = e.clientX;
      _rmbLastY = e.clientY;
      e.preventDefault();
    }
  });

  renderer.domElement.addEventListener('mousemove', function(e) {
    if (!_rmbDown) return;
    var dx = e.clientX - _rmbLastX;
    var dy = e.clientY - _rmbLastY;
    _rmbLastX = e.clientX;
    _rmbLastY = e.clientY;
    // Y-axis (horizontal drag) works in all camera modes
    var _sens = (typeof INPUT_CFG !== 'undefined') ? INPUT_CFG.mouseSens : 0.008;
    var _invY = (typeof INPUT_CFG !== 'undefined') ? INPUT_CFG.invertY : false;
    pivot.rotation.y += dx * _sens;
    // X-axis (vertical drag / tilt) — clamped, respects invert Y setting
    pivot.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2,
      pivot.rotation.x + (_invY ? -dy : dy) * _sens));
    coords();
  });

  window.addEventListener('mouseup', function(e) {
    if (e.button === 2) _rmbDown = false;
  });
  // Clear stale RMB flag when window loses focus
  window.addEventListener('blur', function() { _rmbDown = false; _panDragging = false; });

  // Prevent context menu on canvas
  renderer.domElement.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  /* ── Mouse wheel: layer scroll (default) or zoom (RMB must be PHYSICALLY held) ── */
  renderer.domElement.addEventListener('wheel', function(e) {
    if (menuOpen()) return;
    e.preventDefault();
    // e.buttons bit 2 = RMB actually held right now — prevents stale _rmbDown
    var rmbActuallyHeld = !!(e.buttons & 2);
    if (!rmbActuallyHeld) _rmbDown = false;
    if (rmbActuallyHeld) {
      // RMB + wheel → zoom along camera→lookAt axis
      var factor = e.deltaY > 0 ? 1.08 : 0.93;
      if (cameraMode === CAMERA_MODES.FREE) {
        camera.position.multiplyScalar(factor);
      } else {
        var zd = new THREE.Vector3().subVectors(camera.position, _camLookAt);
        zd.multiplyScalar(factor);
        var zlen = zd.length();
        if (zlen < 5)  zd.setLength(5);
        if (zlen > 80) zd.setLength(80);
        camera.position.copy(_camLookAt).add(zd);
      }
    } else {
      // Plain wheel → layer scroll
      var _spd = (typeof INPUT_CFG !== 'undefined') ? INPUT_CFG.scrollSpeed : 1;
      var layerDir = e.deltaY > 0 ? -_spd : _spd;
      var newZ = Math.max(0, Math.min(LAYERS-1, activeZ + layerDir));
      if (newZ === activeZ) return;
      activeZ = newZ;
      var slider = document.getElementById('zSlider');
      if (slider) slider.value = newZ;
      update(); coords();
      SND.layer(newZ); HAP.vib('layer'); flashLayerIndicator(newZ);
      camOnLayerChange();
    }
  }, { passive: false });

  /* ── MMB hold + drag: zoom ── */
  var _mmbDown = false, _mmbLastY = 0;
  renderer.domElement.addEventListener('mousedown', function(e) {
    if (e.button === 1) { _mmbDown = true; _mmbLastY = e.clientY; e.preventDefault(); }
  });
  renderer.domElement.addEventListener('mousemove', function(e) {
    if (!_mmbDown) return;
    var mdy = e.clientY - _mmbLastY; _mmbLastY = e.clientY;
    var mfac = mdy > 0 ? 1.015 : 0.985;
    if (cameraMode === CAMERA_MODES.FREE) {
      camera.position.multiplyScalar(mfac);
    } else {
      var md = new THREE.Vector3().subVectors(camera.position, _camLookAt).multiplyScalar(mfac);
      var ml = md.length();
      if (ml < 5) md.setLength(5); if (ml > 80) md.setLength(80);
      camera.position.copy(_camLookAt).add(md);
    }
  });
  window.addEventListener('mouseup', function(e) { if (e.button === 1) _mmbDown = false; });

  /* ── Alt+drag or Pan-mode: pan the board in world XZ plane ── */
  var _panDragging = false, _panLastX = 0, _panLastY = 0;
  var _panModeActive = false;

  var _panUpAxis = new THREE.Vector3();

  function _doBoardPan(dx, dy) {
    // Pan = move the board up / down ON SCREEN. Drag up → board up.
    // Horizontal drag is ignored; zoom already handles depth.
    //
    // The axis is the CAMERA's own up vector, not world Y. World Y is only the
    // screen-vertical axis when the camera looks along the horizon; the steeper
    // it tilts, the more of a world-Y nudge lands along the view direction and
    // reads as zoom instead of pan. In FLAT (straight overhead) world Y IS the
    // view axis, so panning on it was 100% zoom and 0% pan. The camera's up
    // axis is perpendicular to the view direction by construction, so the
    // board's distance to the camera is unchanged and a drag can never read as
    // moving closer or further.
    var dist = camera.position.distanceTo(_camLookAt);
    var scale = dist * 0.0012;
    _panUpAxis.set(0, 1, 0).applyQuaternion(camera.quaternion);
    pivot.position.addScaledVector(_panUpAxis, -dy * scale);
  }

  renderer.domElement.addEventListener('mousedown', function(e) {
    if (e.button === 0 && (e.altKey || _panModeActive)) {
      _panDragging = true;
      _panLastX = e.clientX; _panLastY = e.clientY;
      e.stopPropagation();
      e.preventDefault();
    }
  });
  renderer.domElement.addEventListener('mousemove', function(e) {
    if (!_panDragging) return;
    _doBoardPan(e.clientX - _panLastX, e.clientY - _panLastY);
    _panLastX = e.clientX; _panLastY = e.clientY;
  });
  window.addEventListener('mouseup', function(e) {
    if (e.button === 0) _panDragging = false;
  });

  // Pan button
  (function() {
    var btn = document.getElementById('panBoardBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      _panModeActive = !_panModeActive;
      window._panModeActive = _panModeActive;
      btn.style.color = _panModeActive ? '#00ccff' : '#aaa';
      btn.style.borderColor = _panModeActive ? '#00ccff' : '#333';
      btn.title = _panModeActive
        ? 'Pan mode ON — drag up/down to raise/lower the board. Double-click to reset. Click to exit.'
        : 'Pan board up/down — Alt+drag, or click to toggle pan mode. Double-click to reset.';
      renderer.domElement.style.cursor = _panModeActive ? 'grab' : '';
    });
    btn.addEventListener('dblclick', function(e) {
      pivot.position.copy(window.PIVOT_HOME || new THREE.Vector3(0, 0, 0));
      _panModeActive = false;
      window._panModeActive = false;
      btn.style.color = '#aaa'; btn.style.borderColor = '#333';
      renderer.domElement.style.cursor = '';
      e.stopPropagation();
    });
  })();

  /* ── Tab: hold to see all-layers ghost mode ── */
  var _tabHeld = false;
  var _preTabOpacities = [];  // saved piece opacities

  function applyAllLayersView(on) {
    if (on === _tabHeld) return;
    _tabHeld = on;
    if (on) {
      // Show all pieces at equal mid opacity across all layers
      pieces.forEach(function(p) {
        setPieceMat(p, { transparent: true, opacity: 0.55 });
      });
      // Show all layers
      layers.forEach(function(l) { l.visible = true; });
    } else {
      // Restore normal layer visibility
      update();
    }
  }

  /* ── Keyboard shortcuts ── */
  document.addEventListener('keydown', function(e) {
    // Ignore when typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    var key = e.key;

    // Numbers 1-4: jump to layer (5-8 unused in 4L)
    if (key >= '1' && key <= '4') {
      if (menuOpen()) return;
      var newZ2 = parseInt(key) - 1;
      if (newZ2 === activeZ) return;
      activeZ = newZ2;
      var sl = document.getElementById('zSlider');
      if (sl) sl.value = newZ2;
      update(); coords();
      SND.layer(newZ2); flashLayerIndicator(newZ2);
      camOnLayerChange();
      return;
    }
    if (key >= '5' && key <= '8') return; // no-op in 4L

    // Arrow Up / Down / Left / Right: move board cursor
    if (key === 'ArrowUp') {
      if (menuOpen()) return;
      e.preventDefault();
      if (window.gpCursor && window.updateGamepadCursor) {
        window.gpCursor.kbActive = true;
        window.updateGamepadCursor(window.gpCursor.x, window.gpCursor.y + 1);
      }
      return;
    }
    if (key === 'ArrowDown') {
      if (menuOpen()) return;
      e.preventDefault();
      if (window.gpCursor && window.updateGamepadCursor) {
        window.gpCursor.kbActive = true;
        window.updateGamepadCursor(window.gpCursor.x, window.gpCursor.y - 1);
      }
      return;
    }

    // Escape: deselect or pause
    if (key === 'Escape') {
      if (menuOpen()) return;
      if (selectedPawn) { clearSelection(); return; }
      if (gameStarted || reviewing) {
        document.getElementById('pauseMenu').style.display = 'flex';
      }
      return;
    }

    // Enter: confirm cursor selection (keyboard board navigation)
    if (key === 'Enter') {
      if (menuOpen()) return;
      if (window.gpCursor && window.gpCursor.kbActive && !reviewing && window.handleGamepadSelect) {
        window.handleGamepadSelect(window.gpCursor.x, window.gpCursor.y);
      }
      return;
    }

    // Tab: all-layers view while held
    if (key === 'Tab') {
      e.preventDefault();
      if (!menuOpen()) applyAllLayersView(true);
      return;
    }

    // R: rotate board 180°
    if (key === 'r' || key === 'R') {
      if (menuOpen()) return;
      var rbtn = document.getElementById('rotateBoardBtn');
      if (rbtn && rbtn.style.display !== 'none') rbtn.click();
      return;
    }

    // M: toggle move list
    if (key === 'm' || key === 'M') {
      if (menuOpen()) return;
      var panel = document.getElementById('movePanel');
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      return;
    }

    // V: cycle camera mode
    if (key === 'v' || key === 'V') {
      if (menuOpen()) return;
      var vtgl = document.getElementById('viewToggle');
      if (vtgl) vtgl.click();
      return;
    }

    if (key === 'ArrowLeft') {
      if (menuOpen()) return;
      e.preventDefault();
      if (reviewing) { var pm = document.getElementById('prevMove'); if (pm) pm.click(); return; }
      if (window.gpCursor && window.updateGamepadCursor) {
        window.gpCursor.kbActive = true;
        window.updateGamepadCursor(window.gpCursor.x + 1, window.gpCursor.y);
      }
      return;
    }
    if (key === 'ArrowRight') {
      if (menuOpen()) return;
      e.preventDefault();
      if (reviewing) { var nm = document.getElementById('nextMove'); if (nm) nm.click(); return; }
      if (window.gpCursor && window.updateGamepadCursor) {
        window.gpCursor.kbActive = true;
        window.updateGamepadCursor(window.gpCursor.x - 1, window.gpCursor.y);
      }
      return;
    }

    // F: flip/rotate board 180° (alias)
    if (key === 'f' || key === 'F') {
      if (menuOpen()) return;
      var rbtn2 = document.getElementById('rotateBoardBtn');
      if (rbtn2 && rbtn2.style.display !== 'none') rbtn2.click();
      return;
    }

    // Q / E: layer down / up with wrap-around (1→4→3→…→1)
    if (key === 'q' || key === 'Q') {
      if (menuOpen()) return;
      e.preventDefault();
      var qz = (activeZ - 1 + LAYERS) % LAYERS;
      activeZ = qz; var qsl = document.getElementById('zSlider'); if (qsl) qsl.value = qz;
      update(); coords(); SND.layer(qz); flashLayerIndicator(qz); camOnLayerChange();
      return;
    }
    if (key === 'e' || key === 'E') {
      if (menuOpen()) return;
      e.preventDefault();
      var ez = (activeZ + 1) % LAYERS;
      activeZ = ez; var esl = document.getElementById('zSlider'); if (esl) esl.value = ez;
      update(); coords(); SND.layer(ez); flashLayerIndicator(ez); camOnLayerChange();
      return;
    }

    // + / = : zoom in     -  : zoom out
    if (key === '+' || key === '=' || key === 'PageUp') {
      if (menuOpen()) return;
      if (cameraMode === CAMERA_MODES.FREE) { camera.position.multiplyScalar(0.9); }
      else { var dzi=new THREE.Vector3().subVectors(camera.position,_camLookAt).multiplyScalar(0.9); if(dzi.length()<5)dzi.setLength(5); camera.position.copy(_camLookAt).add(dzi); }
      return;
    }
    if (key === '-' || key === '_' || key === 'PageDown') {
      if (menuOpen()) return;
      if (cameraMode === CAMERA_MODES.FREE) { camera.position.multiplyScalar(1.1); }
      else { var dzo=new THREE.Vector3().subVectors(camera.position,_camLookAt).multiplyScalar(1.1); if(dzo.length()>80)dzo.setLength(80); camera.position.copy(_camLookAt).add(dzo); }
      return;
    }

    // Space: deselect piece
    if (key === ' ') {
      if (menuOpen()) return;
      e.preventDefault();
      if (selectedPawn) clearSelection();
      return;
    }

    // Home: reset camera to default for current mode
    if (key === 'Home') {
      if (menuOpen()) return;
      e.preventDefault();
      if (typeof camOnLayerChange === 'function') camOnLayerChange();
      return;
    }

  }); // end keydown

  document.addEventListener('keyup', function(e) {
    if (e.key === 'Tab') applyAllLayersView(false);
  });

  // Also release Tab view if window loses focus
  window.addEventListener('blur', function() { applyAllLayersView(false); });

})(); // end initPCInput

/* ================================================================
   MULTI-DEVICE LAYOUT PROFILES
   Players can save up to 3 named layout profiles (e.g. "Desktop",
   "Laptop", "TV"). Each is stored under a separate localStorage key.
   The active profile name is stored in cc_layout_profile.
================================================================ */

(function initLayoutProfiles() {
  var PROFILE_KEY   = 'cc_layout_profile';    // active profile name
  var PROFILE_NAMES = ['Desktop', 'Mobile', 'TV'];

  function profileStorageKey(name) {
    return 'cc_layout_v2_' + name.toLowerCase().replace(/\s+/g,'_');
  }

  function loadProfile(name) {
    try {
      var raw = localStorage.getItem(profileStorageKey(name));
      if (raw) {
        LAYOUT_V2 = JSON.parse(raw);
        if (!LAYOUT_V2.version) LAYOUT_V2 = JSON.parse(JSON.stringify(LAYOUT_DEFAULT_V2));
      } else {
        LAYOUT_V2 = JSON.parse(JSON.stringify(LAYOUT_DEFAULT_V2));
      }
    } catch(e) {
      LAYOUT_V2 = JSON.parse(JSON.stringify(LAYOUT_DEFAULT_V2));
    }
    localStorage.setItem(PROFILE_KEY, name);
    applyAllLayoutV2();
    syncProfileUI();
  }

  function saveCurrentProfile() {
    var name = localStorage.getItem(PROFILE_KEY) || PROFILE_NAMES[0];
    try { localStorage.setItem(profileStorageKey(name), JSON.stringify(LAYOUT_V2)); } catch(e) {}
  }

  // Patch saveLayoutV2 to also write to named profile
  var _origSaveLayout = saveLayoutV2;
  saveLayoutV2 = function() {
    _origSaveLayout();
    saveCurrentProfile();
  };

  function syncProfileUI() {
    var active = localStorage.getItem(PROFILE_KEY) || PROFILE_NAMES[0];
    document.querySelectorAll('[data-layout-profile]').forEach(function(btn) {
      var on = btn.dataset.layoutProfile === active;
      btn.style.borderColor = on ? '#00ccff' : '#222';
      btn.style.color       = on ? '#00ccff' : '#555';
    });
  }

  // Build the profile picker UI and inject it into the Layout settings page
  var layoutPage = document.getElementById('pageLayout');
  if (layoutPage) {
    var profileSection = document.createElement('div');
    profileSection.className = 'settingSection';
    profileSection.innerHTML =
      '<h3>Layout Profile</h3>' +
      '<div style="font-size:9px;color:#444;letter-spacing:1px;margin-bottom:8px;line-height:1.7;">' +
        'Save separate layouts for different devices. Each profile is stored independently.' +
      '</div>' +
      '<div style="display:flex;gap:5px;flex-wrap:wrap;" id="layoutProfileRow">' +
        PROFILE_NAMES.map(function(n) {
          return '<button data-layout-profile="' + n + '" style="background:#111;border:1px solid #222;color:#555;' +
                 'padding:4px 10px;font-family:monospace;font-size:9px;letter-spacing:1px;cursor:pointer;">' + n.toUpperCase() + '</button>';
        }).join('') +
      '</div>';
    // Insert before the first child of layoutPage
    layoutPage.insertBefore(profileSection, layoutPage.firstChild);

    // Wire buttons
    document.querySelectorAll('[data-layout-profile]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        SND.ui();
        loadProfile(btn.dataset.layoutProfile);
      });
    });
  }

  // Load the previously active profile on boot
  var savedProfile = localStorage.getItem(PROFILE_KEY) || PROFILE_NAMES[0];
  loadProfile(savedProfile);

  // Expose for external use
  window._ccLayoutProfiles = { load: loadProfile, save: saveCurrentProfile, names: PROFILE_NAMES };

})(); // end initLayoutProfiles

/* ── PC input hint overlay (shows key map once per session) ── */
(function showPCHint() {
  if (localStorage.getItem('cc_pc_hint_seen') || !window.matchMedia('(pointer:fine)').matches) return;
  var hint = document.createElement('div');
  hint.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);'
    + 'background:rgba(0,0,0,0.88);border:1px solid #333;color:#555;font-family:monospace;'
    + 'font-size:9px;letter-spacing:1px;padding:8px 16px;z-index:50;pointer-events:none;'
    + 'white-space:nowrap;line-height:2;text-align:center;';
  hint.innerHTML =
    'LMB select/move &nbsp;·&nbsp; RMB orbit &nbsp;·&nbsp; Scroll zoom &nbsp;·&nbsp; Shift+Scroll layer<br>'
    + 'Q/E or 1-4 layer &nbsp;·&nbsp; +/− zoom &nbsp;·&nbsp; Tab all-layers &nbsp;·&nbsp; Space deselect<br>'
    + 'R/F flip board &nbsp;·&nbsp; V camera &nbsp;·&nbsp; M moves &nbsp;·&nbsp; Esc pause';
  document.body.appendChild(hint);
  setTimeout(function() {
    hint.style.transition = 'opacity 0.6s';
    hint.style.opacity = '0';
    setTimeout(function() { hint.remove(); }, 700);
  }, 5000);
  localStorage.setItem('cc_pc_hint_seen', '1');
})();

/* ================================================================
   INPUT SETTINGS SYSTEM
================================================================ */
var INPUT_CFG = {
  mouseSens:       0.008,  // multiplier for RMB drag
  invertY:         false,
  scrollSpeed:     1,
  gamepadEnabled:  true,
  gamepadDeadzone: 0.15,
  gamepadSens:     10,
  swipeMode:       'default', // 'default': 1F=layer/2F=rotate; 'swapped': 1F=rotate/2F=layer
};

function loadInputCFG() {
  try {
    var s = localStorage.getItem('cc_input_cfg');
    if (s) Object.assign(INPUT_CFG, JSON.parse(s));
  } catch(e) {}
}
function saveInputCFG() {
  try { localStorage.setItem('cc_input_cfg', JSON.stringify(INPUT_CFG)); } catch(e) {}
}
loadInputCFG();

// Wire Input page controls
(function wireInputPage() {
  // Mouse sensitivity slider
  var sensEl = document.getElementById('inputMouseSens');
  if (sensEl) {
    sensEl.value = Math.round(INPUT_CFG.mouseSens * 1000);
    sensEl.addEventListener('input', function(e) {
      INPUT_CFG.mouseSens = parseInt(e.target.value) / 1000;
      saveInputCFG();
    });
  }

  // Invert Y
  var invY = document.getElementById('inputInvertY');
  if (invY) {
    invY.checked = INPUT_CFG.invertY;
    invY.addEventListener('change', function(e) {
      INPUT_CFG.invertY = e.target.checked;
      saveInputCFG();
    });
  }

  // Scroll speed chips
  document.querySelectorAll('[data-scroll-speed]').forEach(function(btn) {
    btn.classList.toggle('active', parseInt(btn.dataset.scrollSpeed) === INPUT_CFG.scrollSpeed);
    btn.onclick = function() {
      INPUT_CFG.scrollSpeed = parseInt(btn.dataset.scrollSpeed);
      document.querySelectorAll('[data-scroll-speed]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.scrollSpeed === btn.dataset.scrollSpeed);
      });
      saveInputCFG();
    };
  });

  // Gamepad enabled
  var gpOn = document.getElementById('inputGamepadOn');
  if (gpOn) {
    gpOn.checked = INPUT_CFG.gamepadEnabled;
    gpOn.addEventListener('change', function(e) {
      INPUT_CFG.gamepadEnabled = e.target.checked;
      saveInputCFG();
    });
  }

  // Gamepad deadzone
  var gpDead = document.getElementById('inputGamepadDeadzone');
  if (gpDead) {
    gpDead.value = Math.round(INPUT_CFG.gamepadDeadzone * 100);
    gpDead.addEventListener('input', function(e) {
      INPUT_CFG.gamepadDeadzone = parseInt(e.target.value) / 100;
      saveInputCFG();
    });
  }

  // Gamepad sensitivity
  var gpSens = document.getElementById('inputGamepadSens');
  if (gpSens) {
    gpSens.value = INPUT_CFG.gamepadSens;
    gpSens.addEventListener('input', function(e) {
      INPUT_CFG.gamepadSens = parseInt(e.target.value);
      saveInputCFG();
    });
  }

  // Touch toggles mirror existing UI_PREFS toggles (advSwipeLayer2, advPinchZoom2, advBoardRotate2)
  var mirrorMap = [
    ['advSwipeLayer2','swipeLayer'],
    ['advPinchZoom2','pinchZoom'],
    ['advBoardRotate2','boardRotate'],
  ];
  mirrorMap.forEach(function(pair) {
    var el = document.getElementById(pair[0]); if (!el) return;
    el.checked = UI_PREFS[pair[1]];
    el.addEventListener('change', function(e) {
      var fn = typeof _applyUIPrefWrapped==='function' ? _applyUIPrefWrapped : applyUIPref;
      fn(pair[1], e.target.checked);
      // Also sync the original advPage toggle
      var orig = document.getElementById('adv'+pair[1].charAt(0).toUpperCase()+pair[1].slice(1));
      if (orig) orig.checked = e.target.checked;
    });
  });

  // Swipe mode chips
  document.querySelectorAll('[data-swipemode]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.swipemode === INPUT_CFG.swipeMode);
    btn.onclick = function() {
      INPUT_CFG.swipeMode = btn.dataset.swipemode;
      document.querySelectorAll('[data-swipemode]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.swipemode === INPUT_CFG.swipeMode);
      });
      saveInputCFG();
    };
  });
})();

// Patch the RMB mousemove handler to use INPUT_CFG values
// (find and patch the internal dx/dy application)
// The handler already exists — we expose INPUT_CFG to it via the global scope.
// The mousemove handler reads INPUT_CFG.mouseSens at call time so no re-patching needed.

/* ================================================================
   KEY BINDINGS — user-assignable keyboard shortcuts (v11)
================================================================ */
var _KEY_BINDINGS_DEFAULTS = {
  layerUp:    'e',
  layerDown:  'q',
  flipBoard:  'r',
  cameraMode: 'v',
  moveList:   'm',
  deselect:   ' ',
  pause:      'Escape',
  allLayers:  'Tab',
  reviewPrev: 'ArrowLeft',
  reviewNext: 'ArrowRight',
  zoomIn:     '+',
  zoomOut:    '-',
  resetCam:   'Home',
};
var _KEY_BINDINGS_LABELS = {
  layerUp:    'Layer Up (Q/E)',
  layerDown:  'Layer Down (Q/E)',
  flipBoard:  'Flip Board (R/F)',
  cameraMode: 'Cycle Camera',
  moveList:   'Toggle Move List',
  deselect:   'Deselect Piece',
  pause:      'Pause / Deselect',
  allLayers:  'All Layers View (hold)',
  reviewPrev: 'Review ← Prev',
  reviewNext: 'Review → Next',
  zoomIn:     'Zoom In',
  zoomOut:    'Zoom Out',
  resetCam:   'Reset Camera',
};
var KEY_BINDINGS = {};
Object.assign(KEY_BINDINGS, _KEY_BINDINGS_DEFAULTS);
(function() {
  try { var s=localStorage.getItem('cc_key_bindings'); if(s) Object.assign(KEY_BINDINGS, JSON.parse(s)); } catch(e) {}
})();
function _saveKeyBindings() {
  try { localStorage.setItem('cc_key_bindings', JSON.stringify(KEY_BINDINGS)); } catch(e) {}
}
function _fmtKey(k) {
  var map = { ' ':'Space', 'ArrowUp':'↑', 'ArrowDown':'↓', 'ArrowLeft':'←', 'ArrowRight':'→',
              'Tab':'Tab', 'Escape':'Esc', 'Home':'Home', 'End':'End',
              'PageUp':'PgUp', 'PageDown':'PgDn', 'Backspace':'⌫', 'Delete':'Del' };
  return map[k] || (k.length === 1 ? k.toUpperCase() : k);
}
(function buildKeyBindUI() {
  var container = document.getElementById('keyBindTable');
  if (!container) return;
  var _waitingAction = null;
  function render() {
    container.innerHTML = '';
    var actions = Object.keys(_KEY_BINDINGS_DEFAULTS);
    actions.forEach(function(action) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #0f0f0f;cursor:pointer;';
      row.dataset.action = action;
      var label = document.createElement('span');
      label.style.cssText = 'font-size:10px;color:#888;flex:1;';
      label.textContent = _KEY_BINDINGS_LABELS[action] || action;
      var keyBadge = document.createElement('span');
      keyBadge.style.cssText = 'font-size:9px;letter-spacing:1px;padding:2px 7px;border:1px solid #333;background:#111;color:#00ccff;border-radius:2px;min-width:36px;text-align:center;font-family:monospace;';
      keyBadge.textContent = _fmtKey(KEY_BINDINGS[action]);
      if (_waitingAction === action) {
        keyBadge.style.borderColor = '#ff8800'; keyBadge.style.color = '#ff8800';
        keyBadge.textContent = '…'; label.style.color = '#ff8800';
      }
      row.appendChild(label); row.appendChild(keyBadge); container.appendChild(row);
      row.addEventListener('click', function() {
        _waitingAction = (_waitingAction === action) ? null : action;
        render();
        if (_waitingAction) {
          function onKey(ev) {
            if (['Control','Shift','Alt','Meta'].indexOf(ev.key) !== -1) return;
            ev.preventDefault(); ev.stopPropagation();
            KEY_BINDINGS[action] = ev.key;
            _saveKeyBindings();
            _waitingAction = null;
            render();
            document.removeEventListener('keydown', onKey, true);
          }
          document.addEventListener('keydown', onKey, true);
        }
      });
    });
  }
  render();
  var resetBtn = document.getElementById('keyBindReset');
  if (resetBtn) {
    resetBtn.onclick = function() {
      Object.assign(KEY_BINDINGS, _KEY_BINDINGS_DEFAULTS);
      _saveKeyBindings(); _waitingAction = null; render(); SND.ui();
    };
  }
})();

/* ================================================================
   GAMEPAD SUPPORT — GAMEPAD-FIRST REDESIGN
================================================================ */
(function initGamepad() {

  /* ── State ── */
  var _gpConnected   = false;
  var _gpActive      = false;
  var _kbCursorActive = false;
  var _gpCursorX     = 3;
  var _gpCursorY     = 3;
  window.gpCursor = { x: 3, y: 3, kbActive: false };
  var _reviewMode    = false;   // true while in move-review (View button)
  var _r3WasHeld     = false;
  var _btnPrev       = {};
  var _stickCursorCD = 0;
  var _menuNavCD     = 0;
  var _menuFocusEl   = null;
  var _lastMenuId    = '';

  /* ── Button helpers ── */
  function btnPressed(gp, idx) {
    var val  = !!(gp.buttons[idx] && (gp.buttons[idx].pressed || gp.buttons[idx].value > 0.5));
    var prev = !!_btnPrev[idx];
    _btnPrev[idx] = val;
    return val && !prev;
  }
  function btnHeld(gp, idx) {
    return !!(gp.buttons[idx] && (gp.buttons[idx].pressed || gp.buttons[idx].value > 0.5));
  }
  function triggerVal(gp, idx) {
    return gp.buttons[idx] ? (gp.buttons[idx].value || 0) : 0;
  }
  function axisVal(gp, idx) {
    var v = gp.axes[idx] || 0;
    return Math.abs(v) > INPUT_CFG.gamepadDeadzone ? v : 0;
  }

  /* ── Input mode switching ── */
  function setGamepadMode(on) {
    if (_gpActive === on) return;
    _gpActive = on;
    document.body.classList.toggle('gamepad-mode', on);
    document.body.style.cursor = on ? 'none' : '';
    if (_gpCursorMesh) _gpCursorMesh.visible = on && !_layerModeActive;
    _injectGPIcons();
  }
  ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach(function(ev) {
    document.addEventListener(ev, function() { if (_gpActive) setGamepadMode(false); }, { passive: true });
  });

  /* ── Controller type detection ── */
  function getGamepadLayout() {
    var gps = []; try { gps = Array.from(navigator.getGamepads ? navigator.getGamepads() : []); } catch(e) {}
    for (var i = 0; i < gps.length; i++) {
      if (!gps[i] || !gps[i].connected) continue;
      var id = (gps[i].id || '').toLowerCase();
      if (id.indexOf('sony') !== -1 || id.indexOf('playstation') !== -1 ||
          id.indexOf('dualshock') !== -1 || id.indexOf('dualsense') !== -1 ||
          id.indexOf('054c') !== -1) return 'ps';
      return 'xbox';
    }
    return 'xbox';
  }
  window.getGamepadLayout = getGamepadLayout;

  /* ── Button icon injection ── */
  var _GP_ICONS = {
    xbox: { confirm:'A',  cancel:'B',  action1:'X',  action2:'Y',  l1:'LB', r1:'RB', l2:'LT', r2:'RT', start:'☰',       select:'⧉'     },
    ps:   { confirm:'✕', cancel:'◯', action1:'□', action2:'△', l1:'L1', r1:'R1', l2:'L2', r2:'R2', start:'OPTIONS', select:'SHARE' }
  };
  function _injectGPIcons() {
    var icons = _GP_ICONS[getGamepadLayout()] || _GP_ICONS.xbox;
    document.querySelectorAll('[data-gp]').forEach(function(el) {
      var role = el.dataset.gp;
      if (role in icons) el.textContent = icons[role];
    });
  }

  /* ── Gamepad cursor mesh ── */
  var _gpCursorMesh = (function() {
    var m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.38, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.userData.isGPCursor = true;
    m.visible = false;
    pivot.add(m);
    return m;
  })();

  function _placeCursorMesh() {
    if (!_gpCursorMesh || !layers[activeZ]) return;
    _gpCursorMesh.position.set(
      -half + (_gpCursorX + 0.5) * SPACING,
      layers[activeZ].position.y + 0.015,
      -half + (_gpCursorY + 0.5) * SPACING
    );
  }

  function updateGamepadCursor(x, y) {
    _gpCursorX = Math.max(0, Math.min(7, x));
    _gpCursorY = Math.max(0, Math.min(7, y));
    if (window.gpCursor) { window.gpCursor.x = _gpCursorX; window.gpCursor.y = _gpCursorY; }
    _placeCursorMesh();
    if (_gpCursorMesh) _gpCursorMesh.visible = _gpActive || _kbCursorActive || (window.gpCursor && window.gpCursor.kbActive);
  }
  window.updateGamepadCursor = updateGamepadCursor;

  /* ── Layer change (LB = down, RB = up) ── */
  function changeLayer(dir) {
    var nz = Math.max(0, Math.min(LAYERS - 1, activeZ + dir));
    if (nz === activeZ) return;
    activeZ = nz;
    var sl = document.getElementById('zSlider'); if (sl) sl.value = nz;
    update(); coords();
    SND.layer(nz); HAP.vib('layer'); flashLayerIndicator(nz); camOnLayerChange();
    _placeCursorMesh();
  }
  window.changeLayer = changeLayer;

  /* ── Snap back to live position (same as clicking the Live button) ── */
  function _snapToLive() {
    if (!reviewing) return;
    setReviewing(false);
    reviewIndex = history.length - 1;
    loadHistory(reviewIndex);
    if (typeof reviewArrows !== 'undefined') { reviewArrows.forEach(function(a) { pivot.remove(a); }); reviewArrows = []; }
    if (typeof syncMoveNumBar === 'function') syncMoveNumBar();
    _reviewMode = false;
  }

  /* ── Review mode (View button toggle) ── */
  function _enterReview() {
    if (!history || !history.length) return;
    _reviewMode = true;
    if (!reviewing) {
      setReviewing(true);
      reviewIndex = history.length - 1;
      loadHistory(reviewIndex);
      if (typeof updateReviewUI === 'function') updateReviewUI();
    }
  }
  function _exitReview() {
    _reviewMode = false;
    if (reviewing) {
      setReviewing(false);
      reviewIndex = history.length - 1;
      loadHistory(reviewIndex);
      if (typeof reviewArrows !== 'undefined') { reviewArrows.forEach(function(a) { pivot.remove(a); }); reviewArrows = []; }
      if (typeof syncMoveNumBar === 'function') syncMoveNumBar();
    }
  }
  window.enterPreview   = _enterReview;
  window.exitPreview    = _exitReview;
  window._snapToLive    = _snapToLive;
  window.prevMove       = function() { var e = document.getElementById('prevMove'); if (e) e.click(); };
  window.nextMove       = function() { var e = document.getElementById('nextMove'); if (e) e.click(); };
  window.goToLatestMove = _exitReview;

  /* ── Gameplay confirm / cancel ── */
  function handleGamepadSelect(x, y) {
    if (reviewing) { _snapToLive(); return; }
    if (typeof ONLINE !== 'undefined' && ONLINE.inMatch && turn !== ONLINE.myColor) return;
    if (typeof promotionActive !== 'undefined' && promotionActive) return; // handled via menu nav

    var p = occ(x, y, activeZ);

    if (selectedPawn) {
      var legal = getLegalMoves(selectedPawn);
      var move  = legal.find(function(mv2) { return mv2.x === x && mv2.y === y && mv2.z === activeZ; });
      if (move) {
        if (botThinking) return;
        var prev = selectedPawn;
        var pCfg = prev.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
        setOutlineColor(prev, pCfg.outlineColor);
        selectedPawn = null; notifySelectionChanged();
        movePlates.forEach(function(mp) { pivot.remove(mp); }); movePlates = []; pulsePlates = [];
        if (selPlate) { pivot.remove(selPlate); selPlate = null; }
        if (prev.userData.type === 'king' && move.castle) executeCastle(move, prev);
        executeMove(prev, move);
        fadeHighlight(move.x, move.y, move.z, prev);
        if (!gameStarted) gameStarted = true;
        document.getElementById('hud').textContent = turn.charAt(0).toUpperCase() + turn.slice(1) + ' to move';
        return;
      }
      // Switch to another friendly piece at cursor
      if (p && p.userData.color === turn && ((!botColor && !ONLINE.inMatch) || p.userData.color === playerColor)) {
        var pCfg2 = selectedPawn.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
        setOutlineColor(selectedPawn, pCfg2.outlineColor);
        if (selPlate) { pivot.remove(selPlate); selPlate = null; }
        movePlates.forEach(function(mp) { pivot.remove(mp); }); movePlates = []; pulsePlates = [];
        selectedPawn = p; notifySelectionChanged(); SND.select();
        var cfg4 = p.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
        setOutlineColor(p, cfg4.outlineSelColor);
        selPlate = square(p.userData.x, p.userData.y, p.userData.z, true, cfg4.outlineSelColor, CFG.hl.selection.opacity);
        var legal2 = getLegalMoves(p); legalMoves = legal2;
        if (CFG.hl.legal.on) { legal2.forEach(function(mv2) { movePlates.push(square(mv2.x, mv2.y, mv2.z, false, CFG.hl.legal.color, CFG.hl.legal.opacity)); }); }
        return;
      }
      // Deselect
      var pCfg3 = selectedPawn.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
      setOutlineColor(selectedPawn, pCfg3.outlineColor);
      selectedPawn = null; notifySelectionChanged();
      movePlates.forEach(function(mp) { pivot.remove(mp); }); movePlates = []; pulsePlates = [];
      if (selPlate) { pivot.remove(selPlate); selPlate = null; }
      return;
    }

    // No selection — try to pick a piece
    var canPick = p && p.userData.z === activeZ &&
      ((!botThinking && p.userData.color === turn && ((!botColor && !ONLINE.inMatch) || p.userData.color === playerColor)) ||
       (botThinking && botColor && p.userData.color === playerColor));
    if (canPick) {
      selectedPawn = p; notifySelectionChanged(); SND.select();
      var cfg5 = p.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
      setOutlineColor(p, cfg5.outlineSelColor);
      if (selPlate) { pivot.remove(selPlate); selPlate = null; }
      selPlate = square(p.userData.x, p.userData.y, p.userData.z, true, cfg5.outlineSelColor, CFG.hl.selection.opacity);
      var legal3 = getLegalMoves(p); legalMoves = legal3;
      movePlates.forEach(function(mp) { pivot.remove(mp); }); movePlates = []; pulsePlates = [];
      if (CFG.hl.legal.on) { legal3.forEach(function(mv2) { movePlates.push(square(mv2.x, mv2.y, mv2.z, false, CFG.hl.legal.color, CFG.hl.legal.opacity)); }); }
    }
  }

  function handleGamepadCancel() {
    if (!selectedPawn) return;
    var pCfg = selectedPawn.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
    setOutlineColor(selectedPawn, pCfg.outlineColor);
    selectedPawn = null; notifySelectionChanged();
    movePlates.forEach(function(mp) { pivot.remove(mp); }); movePlates = []; pulsePlates = [];
    if (selPlate) { pivot.remove(selPlate); selPlate = null; }
  }
  window.handleGamepadSelect = handleGamepadSelect;
  window.handleGamepadCancel = handleGamepadCancel;

  /* ── Menu navigation (.gp-selected, no .focus()) ── */
  var _ALL_MENU_IDS = [
    'mainMenu', 'playStep1', 'playStep2', 'playStep3',
    'pauseMenu', 'endMenu',
    'modeMenu', 'botMenu',
    'gameModesMenu', 'arcadeMenu', 'ctfMenu',
    'settingsOverlay', 'tutorialOverlay', 'puzzleSelectOverlay', 'helpOverlay',
    'promotionPopup'
  ];

  function _getMenuItems(container) {
    return Array.from(container.querySelectorAll('button, [role="button"]')).filter(function(b) {
      return !b.disabled && b.offsetParent !== null && b.offsetHeight > 0;
    });
  }

  function _setMenuFocus(el) {
    if (_menuFocusEl) _menuFocusEl.classList.remove('gp-selected');
    _menuFocusEl = el;
    if (el) {
      el.classList.add('gp-selected');
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }

  function initMenuFocus(container) {
    var items = _getMenuItems(container);
    _setMenuFocus(items.length ? items[0] : null);
  }

  function updateMenuSelection() {
    if (_menuFocusEl && (!document.body.contains(_menuFocusEl) || _menuFocusEl.offsetParent === null)) {
      _menuFocusEl.classList.remove('gp-selected');
      _menuFocusEl = null;
    }
  }
  window.initMenuFocus       = initMenuFocus;
  window.updateMenuSelection = updateMenuSelection;

  function _getActiveMenu() {
    for (var i = 0; i < _ALL_MENU_IDS.length; i++) {
      var el = document.getElementById(_ALL_MENU_IDS[i]);
      if (el && el.style.display !== 'none') return { el: el, id: _ALL_MENU_IDS[i] };
    }
    return null;
  }

  function handleMenuNav(gp, now) {
    var menu = _getActiveMenu();
    if (!menu) {
      if (_menuFocusEl) _menuFocusEl.classList.remove('gp-selected');
      _menuFocusEl = null; _lastMenuId = '';
      return;
    }
    if (menu.id !== _lastMenuId) { _lastMenuId = menu.id; initMenuFocus(menu.el); }
    updateMenuSelection();
    if (!_menuFocusEl) initMenuFocus(menu.el);

    var items  = _getMenuItems(menu.el);
    if (!items.length) return;
    var curIdx = items.indexOf(_menuFocusEl);
    if (curIdx === -1) { curIdx = 0; _setMenuFocus(items[0]); }

    var stickY    = axisVal(gp, 1);
    var stickX    = axisVal(gp, 0);
    var stickTick = (stickY !== 0 || stickX !== 0) && now - _menuNavCD > 200;
    if (stickTick) _menuNavCD = now;

    var up    = btnPressed(gp, 12) || (stickTick && stickY < -0.3);
    var down  = btnPressed(gp, 13) || (stickTick && stickY >  0.3);
    var left  = btnPressed(gp, 14) || (stickTick && stickX < -0.3);
    var right = btnPressed(gp, 15) || (stickTick && stickX >  0.3);
    var l1tab = btnPressed(gp, 4);
    var r1tab = btnPressed(gp, 5);
    var aBtn  = btnPressed(gp, 0);
    var bBtn  = btnPressed(gp, 1);
    var startBtn = btnPressed(gp, 9);

    if (up || left)    { curIdx = (curIdx - 1 + items.length) % items.length; _setMenuFocus(items[curIdx]); SND.ui && SND.ui(); }
    if (down || right) { curIdx = (curIdx + 1) % items.length;                 _setMenuFocus(items[curIdx]); SND.ui && SND.ui(); }

    // L1/R1 switch tabs when present
    if (l1tab || r1tab) {
      var tabs = Array.from(menu.el.querySelectorAll('.stTab, .advTab'));
      if (tabs.length) {
        var aIdx = tabs.findIndex(function(t) { return t.classList.contains('active'); });
        if (aIdx === -1) aIdx = 0;
        var nextIdx = l1tab ? (aIdx - 1 + tabs.length) % tabs.length : (aIdx + 1) % tabs.length;
        tabs[nextIdx].click();
        _setMenuFocus(tabs[nextIdx]);
        SND.ui && SND.ui();
      }
    }

    // ── Promotion popup: 2×2 grid navigation ──
    if (menu.id === 'promotionPopup') {
      var pu = btnPressed(gp, 12)|0, pd = btnPressed(gp, 13)|0;
      var pl = btnPressed(gp, 14)|0, pr = btnPressed(gp, 15)|0;
      var lb = btnPressed(gp, 4)|0,  rb = btnPressed(gp, 5)|0;
      if (pl || lb) { curIdx = (curIdx - 1 + items.length) % items.length; _setMenuFocus(items[curIdx]); SND.ui && SND.ui(); }
      if (pr || rb) { curIdx = (curIdx + 1) % items.length;                _setMenuFocus(items[curIdx]); SND.ui && SND.ui(); }
      if (pu) { curIdx = (curIdx - 2 + items.length) % items.length; _setMenuFocus(items[curIdx]); SND.ui && SND.ui(); }
      if (pd) { curIdx = (curIdx + 2) % items.length;                _setMenuFocus(items[curIdx]); SND.ui && SND.ui(); }
      if (aBtn && _menuFocusEl) _menuFocusEl.click();
      return;
    }

    if (aBtn && _menuFocusEl) _menuFocusEl.click();

    if (bBtn) {
      var backBtn = menu.el.querySelector(
        '#helpBackBtn, #closeSettings, #ps1Back, #ps2Back, #ps3Back, [id$="BackBtn"], [id$="CloseBtn"]'
      );
      if (backBtn) backBtn.click();
      else if (menu.id === 'pauseMenu') menu.el.style.display = 'none';
    }

    if (startBtn && menu.id === 'pauseMenu') menu.el.style.display = 'none';
  }

  /* ── Connection status ── */
  function updateGamepadStatus(connected) {
    _gpConnected = connected;
    var el = document.getElementById('gamepadStatus');
    if (el) { el.textContent = connected ? '✓ CONNECTED' : 'NOT CONNECTED'; el.style.color = connected ? '#00ccff' : '#444'; }
    if (!connected) setGamepadMode(false);
  }

  window.addEventListener('gamepadconnected', function() {
    updateGamepadStatus(true);
    typeof arcadeAnnounce === 'function' && arcadeAnnounce('🎮 Gamepad connected', 0x00ccff);
    _injectGPIcons();
  });
  window.addEventListener('gamepaddisconnected', function() { updateGamepadStatus(false); });

  if (typeof syncAllSettingsUI === 'function') {
    var _prevSyncForGP = syncAllSettingsUI;
    syncAllSettingsUI = function() {
      _prevSyncForGP();
      var gps2 = []; try { gps2 = Array.from(navigator.getGamepads ? navigator.getGamepads() : []); } catch(e2) {}
      updateGamepadStatus(gps2.some(function(g) { return g && g.connected; }));
    };
  }

  /* ── Main poll loop ── */
  function pollGamepad() {
    requestAnimationFrame(pollGamepad);
    if (!INPUT_CFG.gamepadEnabled) return;
    var gps = []; try { gps = Array.from(navigator.getGamepads ? navigator.getGamepads() : []); } catch(e) { return; }
    var gp = null;
    for (var i = 0; i < gps.length; i++) { if (gps[i] && gps[i].connected) { gp = gps[i]; break; } }
    if (!gp) { if (_gpConnected) updateGamepadStatus(false); return; }
    if (!_gpConnected) updateGamepadStatus(true);

    var now = performance.now();

    var anyInput = gp.buttons.some(function(b) { return b && (b.pressed || b.value > 0.1); }) ||
                   gp.axes.some(function(a) { return Math.abs(a) > 0.1; });
    if (anyInput) setGamepadMode(true);

    // ── Menu / promotion ──
    var anyMenuOpen = _ALL_MENU_IDS.some(function(id) {
      var el = document.getElementById(id); return el && el.style.display !== 'none';
    });
    if (anyMenuOpen) { handleMenuNav(gp, now); return; }

    // ── Analog zoom: LT (6) = zoom out, RT (7) = zoom in ──
    var ltVal = triggerVal(gp, 6);
    var rtVal = triggerVal(gp, 7);
    if (ltVal > 0.05 || rtVal > 0.05) {
      var zf = 1 + (ltVal - rtVal) * 0.012;
      if (cameraMode === CAMERA_MODES.FREE) {
        camera.position.multiplyScalar(zf);
      } else {
        var _zd = new THREE.Vector3().subVectors(camera.position, _camLookAt).multiplyScalar(zf);
        var _zl = _zd.length();
        if (_zl < 5) _zd.setLength(5); if (_zl > 80) _zd.setLength(80);
        camera.position.copy(_camLookAt).add(_zd);
      }
    }

    // ── View/Back (8): toggle review mode ──
    if (btnPressed(gp, 8)) {
      if (_reviewMode) _exitReview(); else _enterReview();
    }

    // ── Review mode: LB/RB + D-pad navigate moves; B/Y exit ──
    if (_reviewMode) {
      var rv_back    = (btnPressed(gp,4)|0) | (btnPressed(gp,12)|0) | (btnPressed(gp,14)|0);
      var rv_forward = (btnPressed(gp,5)|0) | (btnPressed(gp,13)|0) | (btnPressed(gp,15)|0);
      if (rv_back)    { var ep=document.getElementById('prevMove'); if(ep)ep.click(); }
      if (rv_forward) { var en=document.getElementById('nextMove'); if(en)en.click(); }
      if (btnPressed(gp,1) || btnPressed(gp,3)) _exitReview(); // B or Y
      btnPressed(gp,0); btnPressed(gp,2);                      // consume A/X
      if (btnPressed(gp,9)) { var rpm=document.getElementById('pauseMenu'); if(rpm){rpm.style.display='flex';if(typeof initMenuFocus==='function')initMenuFocus(rpm);} }
      _placeCursorMesh();
      return;
    }

    // ── LB (4): layer down   RB (5): layer up ──
    if (btnPressed(gp, 4)) changeLayer(-1);
    if (btnPressed(gp, 5)) changeLayer(1);

    // ── D-pad: cursor ──
    if (btnPressed(gp, 12)) updateGamepadCursor(_gpCursorX, _gpCursorY - 1);
    if (btnPressed(gp, 13)) updateGamepadCursor(_gpCursorX, _gpCursorY + 1);
    if (btnPressed(gp, 14)) updateGamepadCursor(_gpCursorX - 1, _gpCursorY);
    if (btnPressed(gp, 15)) updateGamepadCursor(_gpCursorX + 1, _gpCursorY);

    // ── Left stick: cursor (continuous, 160ms repeat) ──
    var lx = axisVal(gp, 0), ly = axisVal(gp, 1);
    if ((lx !== 0 || ly !== 0) && now - _stickCursorCD > 160) {
      _stickCursorCD = now;
      updateGamepadCursor(
        _gpCursorX + (lx > 0 ? 1 : lx < 0 ? -1 : 0),
        _gpCursorY + (ly > 0 ? 1 : ly < 0 ? -1 : 0)
      );
    }

    // ── Right stick: rotate / tilt board ──
    var rx = axisVal(gp, 2), ry = axisVal(gp, 3);
    if (rx !== 0 || ry !== 0) {
      var sens = INPUT_CFG.gamepadSens * 0.002;
      pivot.rotation.y += rx * sens;
      pivot.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, pivot.rotation.x + ry * sens));
      coords();
    }

    // ── Face buttons ──
    if (btnPressed(gp, 0)) handleGamepadSelect(_gpCursorX, _gpCursorY); // A: select/confirm
    if (btnPressed(gp, 1)) {
      if (selectedPawn) { handleGamepadCancel(); }
      else if (gameStarted) {                                            // B: cancel or open pause
        var bpm=document.getElementById('pauseMenu');
        if(bpm){bpm.style.display='flex';if(typeof initMenuFocus==='function')initMenuFocus(bpm);SND.ui&&SND.ui();}
      }
    }
    if (btnPressed(gp, 2)) { var fbrb=document.getElementById('rotateBoardBtn'); if(fbrb&&fbrb.style.display!=='none')fbrb.click(); } // X: flip 180°
    if (btnPressed(gp, 3)) { var ml=document.getElementById('movePanel'); if(ml)ml.style.display=ml.style.display==='none'?'block':'none'; } // Y: move list

    // ── L3 (10): cycle camera mode ──
    if (btnPressed(gp, 10)) { var vt=document.getElementById('viewToggle'); if(vt)vt.click(); }

    // ── R3 (11): all-layers ghost view (hold) ──
    var r3now = btnHeld(gp, 11);
    if (r3now !== _r3WasHeld) { _r3WasHeld = r3now; typeof applyAllLayersView === 'function' && applyAllLayersView(r3now); }

    // ── Start (9): pause menu ──
    if (btnPressed(gp, 9)) {
      if (gameStarted || reviewing) {
        var spm=document.getElementById('pauseMenu');
        if(spm){spm.style.display='flex';if(typeof initMenuFocus==='function')initMenuFocus(spm);SND.ui&&SND.ui();}
      }
    }

    _placeCursorMesh();
  }

  pollGamepad();

})(); // end initGamepad


/* ================================================================
   GRAPHICS SETTINGS SYSTEM
================================================================ */
var GFX_CFG = {
  dpr:            'native', // '0.75' | '1.0' | 'native' | '2.0'
  antialias:      false,    // requires reload
  glow:           true,
  trails:         true,
  layerHL:        true,
  auras:          true,
  bgAnim:         true,
  fov:            60,
  camTransition:  300,
};

function loadGFXCFG() {
  try { var s=localStorage.getItem('cc_gfx_cfg'); if(s)Object.assign(GFX_CFG,JSON.parse(s)); } catch(e){}
}
function saveGFXCFG() {
  try { localStorage.setItem('cc_gfx_cfg',JSON.stringify(GFX_CFG)); } catch(e){}
}
loadGFXCFG();

function applyGFX() {
  // Pixel ratio
  var dpr;
  if (GFX_CFG.dpr === 'native') dpr = Math.min(window.devicePixelRatio, 2);
  else dpr = parseFloat(GFX_CFG.dpr);
  renderer.setPixelRatio(dpr);

  // FOV
  camera.fov = GFX_CFG.fov;
  camera.updateProjectionMatrix();

  // Camera transition speed
  if (typeof _camTrans !== 'undefined') _camTrans.duration = GFX_CFG.camTransition;

  // Glow: toggle via UI_PREFS.glow flag (read by anim loop)
  UI_PREFS.glow = GFX_CFG.glow;

  // Trails
  if (typeof _applyUIPrefWrapped === 'function') {
    _applyUIPrefWrapped('trails', GFX_CFG.trails);
  } else if (typeof applyUIPref === 'function') {
    applyUIPref('trails', GFX_CFG.trails);
  }

  // Layer highlight FX
  UI_PREFS.layerHL = GFX_CFG.layerHL;

  // BG animation
  var gbEl = document.getElementById('globalBg');
  if (gbEl && !GFX_CFG.bgAnim && BG.type === 'grid') {
    gbEl.style.display = 'none';
  } else if (gbEl && GFX_CFG.bgAnim && BG.type === 'grid') {
    gbEl.style.display = 'block';
  }

  // Auras (arcade): just a flag read by arcadeAnimLoop
  UI_PREFS.arcadeAuras = GFX_CFG.auras;

  saveGFXCFG();
}

// Patch anim glow tick to check GFX_CFG.glow
// (the existing tickGlow IIFE checks UI_PREFS.glow which we set in applyGFX)
if (typeof UI_PREFS !== 'undefined') {
  UI_PREFS.glow = GFX_CFG.glow !== undefined ? GFX_CFG.glow : true;
}

// Patch aura opacity to respect UI_PREFS.arcadeAuras
var _arcadeAnimLoopOrig = null; // aura suppression is flag-based (arcadeAnimLoop checks UI_PREFS.arcadeAuras)

function wireGFXPage() {
  // DPR chips
  document.querySelectorAll('[data-dpr]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.dpr === GFX_CFG.dpr);
    btn.onclick = function() {
      GFX_CFG.dpr = btn.dataset.dpr;
      document.querySelectorAll('[data-dpr]').forEach(function(b) { b.classList.toggle('active', b.dataset.dpr===btn.dataset.dpr); });
      applyGFX();
    };
  });

  // Antialias (note-only, requires reload)
  var aaEl = document.getElementById('gfxAntialias');
  if (aaEl) {
    aaEl.checked = GFX_CFG.antialias;
    aaEl.addEventListener('change', function(e) {
      GFX_CFG.antialias = e.target.checked;
      saveGFXCFG();
      // Store for next load
      localStorage.setItem('cc_gfx_antialias_pending', e.target.checked ? '1' : '0');
    });
  }

  function wireCheck(id, key) {
    var el = document.getElementById(id); if (!el) return;
    el.checked = GFX_CFG[key];
    el.addEventListener('change', function(e) { GFX_CFG[key]=e.target.checked; applyGFX(); });
  }
  wireCheck('gfxGlow',    'glow');
  wireCheck('gfxTrails',  'trails');
  wireCheck('gfxLayerHL', 'layerHL');
  wireCheck('gfxAuras',   'auras');
  wireCheck('gfxBgAnim',  'bgAnim');

  // FOV slider
  var fovEl = document.getElementById('gfxFOV');
  var fovLbl = document.getElementById('gfxFOVLabel');
  if (fovEl) {
    fovEl.value = GFX_CFG.fov;
    if (fovLbl) fovLbl.textContent = GFX_CFG.fov + '°';
    fovEl.addEventListener('input', function(e) {
      GFX_CFG.fov = parseInt(e.target.value);
      if (fovLbl) fovLbl.textContent = GFX_CFG.fov + '°';
      applyGFX();
    });
  }

  // Cam transition chips
  document.querySelectorAll('[data-cam-transition]').forEach(function(btn) {
    btn.classList.toggle('active', parseInt(btn.dataset.camTransition) === GFX_CFG.camTransition);
    btn.onclick = function() {
      GFX_CFG.camTransition = parseInt(btn.dataset.camTransition);
      document.querySelectorAll('[data-cam-transition]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.camTransition === btn.dataset.camTransition);
      });
      applyGFX();
    };
  });

  // Presets
  var _gfxPresetDefs = [
    { id:'gfxPresetLow',   dpr:'0.75',   glow:false, trails:false, layerHL:false, auras:false, bgAnim:false },
    { id:'gfxPresetMed',   dpr:'1.0',    glow:true,  trails:false, layerHL:true,  auras:false, bgAnim:true  },
    { id:'gfxPresetHigh',  dpr:'native', glow:true,  trails:true,  layerHL:true,  auras:true,  bgAnim:true  },
    { id:'gfxPresetUltra', dpr:'2.0',    glow:true,  trails:true,  layerHL:true,  auras:true,  bgAnim:true  },
  ];

  function syncGFXPresetHighlight() {
    var activeId = null;
    _gfxPresetDefs.forEach(function(p) {
      if (GFX_CFG.dpr===p.dpr && GFX_CFG.glow===p.glow && GFX_CFG.trails===p.trails &&
          GFX_CFG.layerHL===p.layerHL && GFX_CFG.auras===p.auras && GFX_CFG.bgAnim===p.bgAnim) {
        activeId = p.id;
      }
    });
    _gfxPresetDefs.forEach(function(p) {
      var el = document.getElementById(p.id); if (!el) return;
      if (p.id === activeId) {
        el.style.background='#001a22'; el.style.borderColor='#00ccff'; el.style.color='#00ccff';
      } else {
        el.style.background='#111'; el.style.borderColor='#333'; el.style.color='#555';
      }
    });
  }

  function setGFXPreset(dpr, glow, trails, layerHL, auras, bgAnim) {
    GFX_CFG.dpr=dpr; GFX_CFG.glow=glow; GFX_CFG.trails=trails;
    GFX_CFG.layerHL=layerHL; GFX_CFG.auras=auras; GFX_CFG.bgAnim=bgAnim;
    applyGFX(); wireGFXPage(); // re-sync controls
  }
  _gfxPresetDefs.forEach(function(p) {
    var el = document.getElementById(p.id); if (!el) return;
    el.onclick = function() {
      setGFXPreset(p.dpr, p.glow, p.trails, p.layerHL, p.auras, p.bgAnim);
    };
  });
  syncGFXPresetHighlight();
}

// Auto-detect initial preset by device — always use highest quality
(function autoGFXPreset() {
  if (localStorage.getItem('cc_gfx_cfg')) return; // user has saved settings — don't override
  // Maximum quality on all devices
  GFX_CFG.dpr = 'native';
  GFX_CFG.glow = true;
  GFX_CFG.trails = true;
  GFX_CFG.layerHL = true;
  GFX_CFG.auras = true;
  GFX_CFG.bgAnim = true;
  // Apply antialias from pending flag if set
  var aaPending = localStorage.getItem('cc_gfx_antialias_pending');
  if (aaPending !== null) GFX_CFG.antialias = aaPending === '1';
})();

// Wire GFX page when settings first opens (elements may not exist at boot time)
var _gfxWired = false;
var _origSyncForGFX = syncAllSettingsUI;
syncAllSettingsUI = function() {
  _origSyncForGFX();
  if (!_gfxWired) { wireGFXPage(); _gfxWired = true; }
  else {
    (function() {
      var defs = [
        { id:'gfxPresetLow',   dpr:'0.75',   glow:false, trails:false, layerHL:false, auras:false, bgAnim:false },
        { id:'gfxPresetMed',   dpr:'1.0',    glow:true,  trails:false, layerHL:true,  auras:false, bgAnim:true  },
        { id:'gfxPresetHigh',  dpr:'native', glow:true,  trails:true,  layerHL:true,  auras:true,  bgAnim:true  },
        { id:'gfxPresetUltra', dpr:'2.0',    glow:true,  trails:true,  layerHL:true,  auras:true,  bgAnim:true  },
      ];
      var activeId = null;
      defs.forEach(function(p) {
        if (GFX_CFG.dpr===p.dpr && GFX_CFG.glow===p.glow && GFX_CFG.trails===p.trails &&
            GFX_CFG.layerHL===p.layerHL && GFX_CFG.auras===p.auras && GFX_CFG.bgAnim===p.bgAnim) activeId = p.id;
      });
      defs.forEach(function(p) {
        var el = document.getElementById(p.id); if (!el) return;
        if (p.id === activeId) { el.style.background='#001a22'; el.style.borderColor='#00ccff'; el.style.color='#00ccff'; }
        else { el.style.background='#111'; el.style.borderColor='#333'; el.style.color='#555'; }
      });
    })();
  }
};

// Apply on boot
applyGFX();

// Patch glow tick to respect GFX_CFG.glow (via UI_PREFS.glow)
// The existing tickGlow traverses pieces and sets opacity — wrap to skip when disabled
var _origAnim2 = anim;
// We patch the glow IIFE result by reading UI_PREFS.glow in the existing loop
// (already done via applyGFX setting UI_PREFS.glow)

// Patch layer highlight to respect GFX_CFG.layerHL
var _origTickLayerHL = tickLayerHighlight;
tickLayerHighlight = function(dt) {
  if (!GFX_CFG.layerHL) return;
  _origTickLayerHL(dt);
};

// Patch arcade aura animation to respect GFX_CFG.auras
// arcadeAnimLoop already runs — we add a flag check
// (arcadeAnimLoop reads UI_PREFS.arcadeAuras — set by applyGFX)

// Glow handled in tickGlow IIFE via UI_PREFS.glow.
// Auras handled in arcadeAnimLoop via UI_PREFS.arcadeAuras.

/* ================================================================
   PUZZLE DEEP-LINK  (?puzzle=N)
================================================================ */
(function() {
  try {
    var p = new URLSearchParams(window.location.search).get('puzzle');
    if (!p) return;
    var idx = parseInt(p, 10) - 1;
    if (isNaN(idx) || idx < 0 || !PUZZLES[idx]) return;
    var overlay = document.getElementById('accountOverlay');
    if (overlay && overlay.style.display !== 'none') {
      var guestBtn = document.getElementById('acctGuestBtn');
      if (guestBtn) guestBtn.click(); else overlay.style.display = 'none';
    }
    startPuzzle(idx);
  } catch(e) {}
})();

/* ================================================================
   KEYBOARD MENU NAVIGATION
   Standalone — uses getComputedStyle so CSS-hidden elements are
   never mistaken for visible menus (unlike el.style.display checks).
================================================================ */
(function() {
  var _kbFocusEl    = null;
  var _kbLastMenuId = '';
  var _kbNavLast    = 0;

  var MENU_IDS = [
    'mainMenu', 'playStep1', 'playStep2', 'playStep3',
    'pauseMenu', 'endMenu', 'modeMenu', 'botMenu',
    'gameModesMenu', 'arcadeMenu', 'ctfMenu',
    'settingsOverlay', 'tutorialOverlay', 'puzzleSelectOverlay', 'helpOverlay',
    'promotionPopup'
  ];

  function getActiveMenu() {
    for (var i = 0; i < MENU_IDS.length; i++) {
      var el = document.getElementById(MENU_IDS[i]);
      if (el && window.getComputedStyle(el).display !== 'none') return { el: el, id: MENU_IDS[i] };
    }
    return null;
  }

  function getItems(container) {
    return Array.from(container.querySelectorAll('button, [role="button"]')).filter(function(b) {
      return !b.disabled && b.offsetHeight > 0 && window.getComputedStyle(b).display !== 'none';
    });
  }

  function setFocus(el) {
    if (_kbFocusEl) _kbFocusEl.classList.remove('gp-selected');
    _kbFocusEl = el;
    if (el) { el.classList.add('gp-selected'); el.scrollIntoView && el.scrollIntoView({ block: 'nearest' }); }
  }

  function initFocus(container) {
    var items = getItems(container);
    setFocus(items.length ? items[0] : null);
  }

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    var k = e.key;
    if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Enter' && k !== 'Escape') return;
    var menu = getActiveMenu();
    if (!menu) {
      if (_kbFocusEl) { _kbFocusEl.classList.remove('gp-selected'); _kbFocusEl = null; }
      _kbLastMenuId = '';
      return;
    }
    e.preventDefault();
    if (menu.id !== _kbLastMenuId) { _kbLastMenuId = menu.id; initFocus(menu.el); }
    if (_kbFocusEl && (!menu.el.contains(_kbFocusEl) || _kbFocusEl.offsetHeight === 0)) initFocus(menu.el);
    if (!_kbFocusEl) initFocus(menu.el);
    var items = getItems(menu.el);
    if (!items.length) return;
    var idx = items.indexOf(_kbFocusEl);
    if (idx === -1) { idx = 0; setFocus(items[0]); }
    var now = performance.now();
    if (k === 'ArrowUp' || k === 'ArrowLeft') {
      if (now - _kbNavLast < 150) return;
      _kbNavLast = now;
      setFocus(items[(idx - 1 + items.length) % items.length]);
      typeof SND !== 'undefined' && SND.ui && SND.ui();
    } else if (k === 'ArrowDown' || k === 'ArrowRight') {
      if (now - _kbNavLast < 150) return;
      _kbNavLast = now;
      setFocus(items[(idx + 1) % items.length]);
      typeof SND !== 'undefined' && SND.ui && SND.ui();
    } else if (k === 'Enter') {
      if (_kbFocusEl) _kbFocusEl.click();
    } else if (k === 'Escape') {
      var back = menu.el.querySelector(
        '#helpBackBtn, #closeSettings, #ps1Back, #ps2Back, #ps3Back, [id$="BackBtn"], [id$="CloseBtn"]'
      );
      if (back) back.click();
      else if (menu.id === 'pauseMenu') menu.el.style.display = 'none';
    }
  });
})();

