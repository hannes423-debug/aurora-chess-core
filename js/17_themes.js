/* ================================================================
   SUGGESTED ADDITIONS
   1. Layer Preview Strip
   2. Ghost Pieces (origin trail)
   3. Opening Book (bot)
   4. Threefold Repetition Draw
   5. Time Controls
   6. Layer-Jump Sound Distinction  ← already exists (SND.placeLayer)
      Enhanced here with pitch variation by distance
   7. Piece Silhouette Projection
================================================================ */

/* ================================================================
   2. GHOST PIECES — origin square silhouette
   When a piece is selected, show a faint "ghost" on its origin
   square across all layers it could reach, so players can track
   vertical range without scrolling.
================================================================ */
const ghostMeshes = [];

function clearGhosts() {
  ghostMeshes.forEach(m => pivot.remove(m));
  ghostMeshes.length = 0;
}

function showGhosts(piece) {
  clearGhosts();
  const { x, y, z } = piece.userData;
  // Show ghost on every layer except the current one where the piece sits
  for (let lz = 0; lz < LAYERS; lz++) {
    if (lz === z) continue;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.7),
      new THREE.MeshBasicMaterial({
        color: piece.userData.color === 'white' ? 0xffffff : 0x888888,
        transparent: true, opacity: 0.12, side: THREE.DoubleSide
      })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(-half + (x + 0.5) * SPACING, layers[lz].position.y + 0.015, -half + (y + 0.5) * SPACING);
    pivot.add(g);
    ghostMeshes.push(g);
  }
}

// Ghost piece updates are now event-driven via notifySelectionChanged()
// Called directly from select/deselect code paths below.
function notifySelectionChanged() {
  if (selectedPawn) showGhosts(selectedPawn);
  else clearGhosts();
}

/* ================================================================
   3. OPENING BOOK — bot plays strong 3D openings for first 4 moves
   Controls the central 2×2×2 cube of layers 3-4.
   Falls back to heuristic search after book is exhausted.
================================================================ */
const OPENING_BOOK = {
  // key: FEN-like move count → [piece_type, from, to] for white/black
  white: [
    // Move 1: d-pawn forward two
    { type:'pawn',   fx:3, fy:1, fz:0, tx:3, ty:3, tz:0 },
    // Move 2: e-pawn forward two
    { type:'pawn',   fx:4, fy:1, fz:0, tx:4, ty:3, tz:0 },
    // Move 3: knight to f3
    { type:'knight', fx:6, fy:0, fz:0, tx:5, ty:2, tz:0 },
    // Move 4: bishop out to c4
    { type:'bishop', fx:5, fy:0, fz:0, tx:2, ty:3, tz:0 },
    // Move 5: knight to c3 (develop queenside knight)
    { type:'knight', fx:1, fy:0, fz:0, tx:2, ty:2, tz:0 },
    // Move 6: c-pawn to c4 (reinforce center)
    { type:'pawn',   fx:2, fy:1, fz:0, tx:2, ty:3, tz:0 },
    // Move 7: 3D — d-pawn claims second layer
    { type:'pawn',   fx:3, fy:3, fz:0, tx:3, ty:3, tz:1 },
    // Move 8: 3D — Nf3 rises to layer 2 for cross-layer pressure
    { type:'knight', fx:5, fy:2, fz:0, tx:5, ty:2, tz:1 },
  ],
  black: [
    { type:'pawn',   fx:3, fy:6, fz:0, tx:3, ty:4, tz:0 },
    { type:'pawn',   fx:4, fy:6, fz:0, tx:4, ty:4, tz:0 },
    { type:'knight', fx:6, fy:7, fz:0, tx:5, ty:5, tz:0 },
    { type:'bishop', fx:5, fy:7, fz:0, tx:2, ty:4, tz:0 },
    { type:'knight', fx:1, fy:7, fz:0, tx:2, ty:5, tz:0 },
    { type:'pawn',   fx:2, fy:6, fz:0, tx:2, ty:4, tz:0 },
    { type:'pawn',   fx:3, fy:4, fz:0, tx:3, ty:4, tz:1 },
    { type:'knight', fx:5, fy:5, fz:0, tx:5, ty:5, tz:1 },
  ]
};

const _botMoveWithBook = botMove;
botMove = function() {
  if (!arcadeSettings.enabled && botColor) {
    const bookMoves = OPENING_BOOK[botColor];
    const moveIdx = moveLog.filter(m => m.turn === botColor).length;
    if (moveIdx < bookMoves.length) {
      const bm = bookMoves[moveIdx];
      const piece = pieces.find(p =>
        p.userData.color === botColor &&
        p.userData.type === bm.type &&
        p.userData.x === bm.fx && p.userData.y === bm.fy && p.userData.z === bm.fz
      );
      if (piece) {
        const legal = getLegalMoves(piece);
        const move = legal.find(m => m.x === bm.tx && m.y === bm.ty && m.z === bm.tz);
        if (move) { executeMove(piece, move); return; }
      }
    }
  }
  _botMoveWithBook();
};

/* ================================================================
   4. THREEFOLD REPETITION DRAW DETECTION
   Tracks board positions by snapshot hash. If same position
   occurs 3 times, offers a draw after the move.
================================================================ */
const positionHistory = {};

function getBoardHash() {
  return JSON.stringify(
    pieces.map(p => `${p.userData.type[0]}${p.userData.color[0]}${p.userData.x}${p.userData.y}${p.userData.z}`)
      .sort().join('|')
  );
}

function checkThreefold() {
  /* Guard at FIRE time, not only where this is scheduled.
     js/23_replay_export.js re-simulates a pasted move list through the real
     engine with endGame/boardText/SND swapped for no-ops, then restores them.
     That window is synchronous, but the callback below is deferred 200ms and
     the DRAW it triggers a further 1200ms — so anything queued during the
     muted run lands long after restore() has put the REAL endGame back, and
     announces a draw over a finished game. Observed: a game White had won
     reopened from a pasted move list as "Draw by threefold repetition". */
  if (window._replayResim) return false;
  const hash = getBoardHash();
  positionHistory[hash] = (positionHistory[hash] || 0) + 1;
  if (positionHistory[hash] >= 3) {
    setTimeout(() => {
      boardText('DRAW', 0xaaaaaa);
      SND.end(false);
      setTimeout(() => endGame('Draw by threefold repetition'), 1200);
    }, 400);
    return true;
  }
  return false;
}

// Hook into executeMove — add after normal turn processing
const _execBeforeThreefold = executeMove;
executeMove = function(piece, t) {
  _execBeforeThreefold.call(this, piece, t);
  // `reviewing` cannot carry the re-simulation case: the reconstruction needs
  // reviewing=false so executeMove still records moveLog/history/snapshots
  // (09_execution.js:44 gates those on it), which is the whole point of the
  // re-run. Hence a separate flag.
  if (!reviewing && !PUZZLE_MODE && !window._replayResim) setTimeout(() => checkThreefold(), 200);
};

/* Position counts are per-game. Exposed because the replay reconstruction has
   to clear them after re-running someone else's game through this engine. */
window.resetThreefoldHistory = function () {
  for (const k in positionHistory) delete positionHistory[k];
};

// Reset position history on new game
const _resetBeforeThreefold = resetBoard;
resetBoard = function(c) {
  _resetBeforeThreefold(c);
  for (const k in positionHistory) delete positionHistory[k];
};

/* ================================================================
   5. TIME CONTROLS
   Optional per-player clock. Shown when enabled via pause menu.
   Default: 10 minutes. Configurable via TIME_CONTROL_MINS.
================================================================ */
let TIME_CONTROL_MINS = 10;
let timeEnabled = false;
let timers = { white: 0, black: 0 };  // seconds remaining
let timerInterval = null;
let timerRunning = false;

// Build clock UI
const clockEl = document.createElement('div');
clockEl.id = 'chessClock';
clockEl.style.cssText = [
  'position:fixed','bottom:104px','left:50%','transform:translateX(-50%)',
  'display:none','gap:8px','z-index:21','font-family:monospace','font-size:12px',
  'align-items:center'
].join(';');
clockEl.innerHTML = `
  <div id="clockW" style="padding:4px 10px;border:1px solid #333;background:#0a0a0a;color:#fff;min-width:56px;text-align:center;">10:00</div>
  <div id="clockHud" style="font-size:9px;letter-spacing:2px;color:#aaa;white-space:nowrap;padding:0 8px;min-width:90px;text-align:center;">White to move</div>
  <div id="clockB" style="padding:4px 10px;border:1px solid #333;background:#0a0a0a;color:#888;min-width:56px;text-align:center;">10:00</div>
  <button id="clockToggleBtn" style="background:#111;border:1px solid #333;color:#555;padding:3px 8px;font-family:monospace;font-size:10px;cursor:pointer;letter-spacing:1px;">⏱ OFF</button>
`;
document.body.appendChild(clockEl);
(function(){
  var hudEl=document.getElementById('hud');
  var chEl=document.getElementById('clockHud');
  if(!hudEl||!chEl)return;
  new MutationObserver(function(){chEl.textContent=hudEl.textContent;}).observe(hudEl,{characterData:true,subtree:true,childList:true});
  // hide standalone hud when clock bar is showing; restore when hidden
  new MutationObserver(function(){
    hudEl.style.visibility=(clockEl.style.display==='none'?'visible':'hidden');
  }).observe(clockEl,{attributes:true,attributeFilter:['style']});
})();

function formatTime(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function updateClockDisplay() {
  const wEl = document.getElementById('clockW');
  const bEl = document.getElementById('clockB');
  if (!wEl || !bEl) return;
  wEl.textContent = formatTime(timers.white);
  bEl.textContent = formatTime(timers.black);
  const activeColor = turn;
  wEl.style.borderColor = (!timerRunning || activeColor==='white') && timeEnabled ? '#fff' : '#333';
  bEl.style.borderColor = (!timerRunning || activeColor==='black') && timeEnabled ? '#fff' : '#333';
  wEl.style.color = timers.white < 30 ? '#ff4444' : '#fff';
  bEl.style.color = timers.black < 30 ? '#ff4444' : '#888';
}
function startTimer(color) {
  if (!timeEnabled) return;
  timerRunning = true;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!timerRunning || reviewing || promotionActive) return;
    timers[color]--;
    updateClockDisplay();
    if (timers[color] <= 0) {
      clearInterval(timerInterval); timerRunning = false;
      boardText('TIME', 0xff4444);
      SND.end(color !== playerColor);
      if (ctfMode) {
        setTimeout(function(){ CTF.handleTimeExpiry(color); }, 1000);
      } else {
        setTimeout(() => endGame((color === 'white' ? 'Black' : 'White') + ' wins on time'), 1000);
      }
    }
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); timerRunning = false; }
function resetTimers() {
  stopTimer();
  timers.white = TIME_CONTROL_MINS * 60;
  timers.black = TIME_CONTROL_MINS * 60;
  updateClockDisplay();
}
document.getElementById('clockToggleBtn').onclick = () => {
  timeEnabled = !timeEnabled;
  document.getElementById('clockToggleBtn').textContent = timeEnabled ? '⏱ ON' : '⏱ OFF';
  document.getElementById('clockToggleBtn').style.color = timeEnabled ? '#00ccff' : '#555';
  if (!timeEnabled) stopTimer();
};
// Hook executeMove to advance timer
const _execBeforeTimer = executeMove;
executeMove = function(piece, t) {
  _execBeforeTimer.call(this, piece, t);
  // Skip auto-start when the bot layer animation is active —
  // the animation callback will call startTimer once it returns to the player's layer.
  if (!reviewing && timeEnabled && !_botLayerAnimActive) {
    stopTimer();
    // turn has already been flipped by base executeMove
    startTimer(turn);
  }
};
// Hook startLocalGame to show/reset clock and reset timers
const _startLocalBeforeTimer = startLocalGame;
startLocalGame = function() {
  _startLocalBeforeTimer();
  resetTimers();
  clockEl.style.display = timeEnabled ? 'flex' : 'none';
};
// Hook resetBoard to reset timers
const _resetBeforeTimer = resetBoard;
resetBoard = function(c) { _resetBeforeTimer(c); resetTimers(); };

/* ================================================================
   6. ENHANCED LAYER-JUMP SOUND
   SND.placeLayer() already exists. Here we extend it with pitch
   that varies by vertical distance (how many layers were crossed),
   making 3D moves feel more distinct by scale.
================================================================ */
const _origPlaceLayer = SND.placeLayer.bind(SND);
SND.placeLayerDist = function(fromZ, toZ) {
  const dist = Math.abs(toZ - fromZ);
  SND._p(c => {
    // Higher pitch + longer tail for bigger jumps
    const baseFreq = 3200 + dist * 400;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.012), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/d.length, 1.8);
    const ns = c.createBufferSource(), ng = c.createGain(), nf = c.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = baseFreq; nf.Q.value = 1.2;
    ns.buffer = buf; ns.connect(nf); nf.connect(ng); ng.connect(c.destination);
    ng.gain.setValueAtTime(SND.vol * 1.0, c.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.015);
    ns.start();
    // Pitched tone: higher note = more layers crossed
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = 'triangle'; o.frequency.value = 1600 + dist * 280;
    g.gain.setValueAtTime(SND.vol * 0.12, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.06 + dist * 0.02);
    o.start(); o.stop(c.currentTime + 0.08 + dist * 0.025);
  });
};
// Patch executeMove to use distance-aware sound
const _execBeforeLayerSnd = executeMove;
executeMove = function(piece, t) {
  // Intercept before base to capture fromZ
  const fromZ = piece.userData.z;
  _execBeforeLayerSnd.call(this, piece, t);
  // If it was a layer-crossing non-capture move, the base already played placeLayer
  // We replace that with our distance version by playing on top (tiny delay avoids double)
  if (fromZ !== t.z && !occ(t.x, t.y, t.z)) {
    setTimeout(() => SND.placeLayerDist(fromZ, t.z), 5);
  }
};




/* ================================================================
   8. MINI-MAP — horizontal strip just above bottom bar.
   8 cells left→right = layers 1→8. Click any cell to jump.
================================================================ */
(function initMinimap() {
  const SZ = 36;

  const wrap = document.createElement('div');
  wrap.id = 'minimap';
  document.body.appendChild(wrap);

  var _mmIsWide = null;
  function _layoutMM() {
    var wide = window.innerWidth / window.innerHeight > 1.3;
    if (wide === _mmIsWide) return;
    _mmIsWide = wide;
    var curDisplay = wrap.style.display || 'none';
    if (wide) {
      wrap.style.cssText = 'position:fixed;right:8px;top:50%;transform:translateY(-50%);display:' + curDisplay + ';flex-direction:column-reverse;align-items:center;gap:3px;z-index:22;pointer-events:auto;padding:4px 0;';
    } else {
      wrap.style.cssText = 'position:fixed;bottom:52px;left:0;right:0;display:' + curDisplay + ';flex-direction:row;justify-content:center;align-items:center;gap:2px;z-index:22;pointer-events:auto;padding:0 8px;';
    }
  }
  _layoutMM();

  const canvases = [];
  for (let z = 0; z < LAYERS; z++) {
    const c = document.createElement('canvas');
    c.width = SZ; c.height = SZ;
    c.style.cssText = 'cursor:pointer;display:block;flex-shrink:0;';
    c.title = 'Layer ' + (z + 1);
    c.addEventListener('click', () => {
      activeZ = z;
      document.getElementById('zSlider').value = z;
      update(); coords();
      SND.layer(z); HAP.vib('layer'); flashLayerIndicator(z);
      camOnLayerChange(); renderMinimap();
    });
    wrap.appendChild(c);
    canvases[z] = c;
  }

  function renderMinimap() {
    for (let z = 0; z < LAYERS; z++) {
      const c = canvases[z];
      const ctx = c.getContext('2d');
      const isActive = z === activeZ;
      ctx.clearRect(0, 0, SZ, SZ);
      ctx.fillStyle = isActive ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, SZ, SZ);
      ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = isActive ? 1.5 : 0.5;
      ctx.strokeRect(0.5, 0.5, SZ - 1, SZ - 1);
      ctx.font = '7px monospace';
      ctx.fillStyle = isActive ? '#fff' : '#444';
      ctx.textAlign = 'left';
      ctx.fillText(z + 1, 2, 8);
      const cell = (SZ - 6) / 8;
      pieces.forEach(p => {
        if (p.userData.z !== z) return;
        const px = 3 + p.userData.x * cell + cell / 2;
        const py = 3 + (7 - p.userData.y) * cell + cell / 2;
        ctx.beginPath();
        ctx.arc(px, py, cell * 0.30, 0, Math.PI * 2);
        ctx.fillStyle = p.userData.color === 'white'
          ? (isActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)')
          : (isActive ? 'rgba(180,180,180,0.45)' : 'rgba(150,150,150,0.10)');
        ctx.fill();
        if (p.userData.type === 'king') {
          ctx.strokeStyle = p.userData.color === 'white' ? 'rgba(0,238,255,0.5)' : 'rgba(255,85,0,0.4)';
          ctx.lineWidth = 0.8; ctx.stroke();
        }
      });
    }
  }

  function checkMM() {
    if (window._uiHidden) { wrap.style.display = 'none'; return; }
    _layoutMM();
    const inGame = document.getElementById('mainMenu').style.display === 'none'
      && document.getElementById('endMenu').style.display === 'none';
    wrap.style.display = inGame ? 'flex' : 'none';
    if (inGame) renderMinimap();
  }
  setInterval(checkMM, 300);

  const _execMM = executeMove;
  executeMove = function(p, t) { _execMM(p, t); setTimeout(renderMinimap, 80); };
  const _zsMM = document.getElementById('zSlider').oninput;
  document.getElementById('zSlider').oninput = function(e) {
    if (_zsMM) _zsMM.call(this, e);
    renderMinimap();
  };
  const _resetMM = resetBoard;
  resetBoard = function(c) { _resetMM(c); setTimeout(renderMinimap, 150); };
})();


/* ================================================================
   9. LAYER TRANSITION ANIMATION
   When activeZ changes, briefly sweep a cyan highlight plane
   upward/downward through the skipped layers to give an "elevator"
   feel, making the 3-D depth tangible.
================================================================ */
(function initLayerTransition() {
  let _prevZ = 0;

  function sweepLayers(fromZ, toZ) {
    const dir      = Math.sign(toZ - fromZ);
    const steps    = Math.abs(toZ - fromZ);
    if (steps < 1) return;
    // Create a thin glowing plane that travels through intermediate layers
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00eeff, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthTest: false
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD * SPACING * 1.02, BOARD * SPACING * 1.02), mat);
    mesh.rotation.x = -Math.PI / 2;
    pivot.add(mesh);

    let step = 0;
    const FRAME_MS = 40;
    function tick() {
      const z = fromZ + step * dir;
      if (z < 0 || z >= LAYERS || step > steps) {
        pivot.remove(mesh);
        mat.dispose(); mesh.geometry.dispose();
        return;
      }
      mesh.position.y = layers[z].position.y + 0.05;
      mat.opacity = (step === 0 || step === steps) ? 0.14 : 0.32;
      step++;
      setTimeout(tick, FRAME_MS);
    }
    tick();
  }

  // Wrap camOnLayerChange
  const _origCOLC = camOnLayerChange;
  camOnLayerChange = function() {
    if (activeZ !== _prevZ) {
      sweepLayers(_prevZ, activeZ);
      _prevZ = activeZ;
    }
    _origCOLC();
  };
})();

/* ================================================================
   10. CROSS-LAYER THREAT VISUALIZATION
   When a piece is selected, show semi-transparent orange/red squares
   on OTHER layers where that piece can attack.
   Distinct from green legal-move plates (same-layer only).
================================================================ */
var crossLayerThreatMeshes = [];

function clearCrossLayerThreats() {
  crossLayerThreatMeshes.forEach(m => pivot.remove(m));
  crossLayerThreatMeshes.length = 0;
}

function showCrossLayerThreats(piece) {
  clearCrossLayerThreats();
  if (!piece) return;
  const curZ = piece.userData.z;
  const moves = getLegalMoves(piece).filter(m => m.z !== curZ);
  moves.forEach(m => {
    const isCapture = !!occ(m.x, m.y, m.z);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: isCapture ? 0xff3300 : 0xff8800,
        transparent: true, opacity: isCapture ? 0.55 : 0.28,
        side: THREE.DoubleSide
      })
    );
    mesh.rotation.x  = -Math.PI / 2;
    mesh.position.set(
      -half + (m.x + 0.5) * SPACING,
      layers[m.z].position.y + 0.012,
      -half + (m.y + 0.5) * SPACING
    );
    mesh.userData.z = m.z;
    if (!isLayerShowing(m.z)) mesh.visible = false;
    pivot.add(mesh);
    crossLayerThreatMeshes.push(mesh);
  });
}

// Hook into the selectedPawn watcher (reuse the 80ms interval pattern)
let _lastSelectedForCLT = null;
setInterval(() => {
  if (selectedPawn !== _lastSelectedForCLT) {
    _lastSelectedForCLT = selectedPawn;
    if (selectedPawn) showCrossLayerThreats(selectedPawn);
    else clearCrossLayerThreats();
  }
}, 80);
// Clear on reset
const _resetCLT = resetBoard;
resetBoard = function(c) { _resetCLT(c); clearCrossLayerThreats(); };



/* Global grid-pulse / floating-glyph background overlay (#globalBg) removed
   in Aurora Chess Core: it was decoration only (no raycasting, no game
   state). The page background is owned by js/30_core.js. */


/* ================================================================
   BOARD SQUARE THEMES
================================================================ */
const SQUARE_THEMES = {
  classic:  { light:'#2a2a2a', dark:'#050505' },
  midnight: { light:'#0d1b2a', dark:'#060d14' },
  cyan:     { light:'#0a2a2a', dark:'#020f0f' },
  amber:    { light:'#2a1a00', dark:'#0f0800' },
  jade:     { light:'#0a2010', dark:'#040e07' },
  ghost:    { light:'#1a1a2e', dark:'#0d0d1a' },
};

function applySquareTheme(key) {
  const t = SQUARE_THEMES[key]; if (!t) return;
  // Update color pickers in UI
  const lc = document.getElementById('lightSquareColor');
  const dc = document.getElementById('darkSquareColor');
  if (lc) lc.value = t.light;
  if (dc) dc.value = t.dark;
  // Rebuild board textures
  rebuildSquareTextures(t.light, t.dark);
}

function rebuildSquareTextures(lightHex, darkHex) {
  // Find all board plane meshes and rebuild their textures
  for (let z = 0; z < LAYERS; z++) {
    const layer = layers[z];
    layer.children.forEach(obj => {
      if (!obj.isMesh || !obj.userData.hasOwnProperty('isLight')) return;
      const isLight = obj.userData.isLight;
      const newTex = makeSquareTex2(isLight, lightHex, darkHex);
      obj.material.map = newTex;
      obj.material.needsUpdate = true;
    });
  }
}

// makeSquareTex2 — like makeSquareTex but with custom colours
function makeSquareTex2(isLight, lightHex, darkHex) {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (isLight) {
    ctx.fillStyle = lightHex;
    ctx.fillRect(0,0,size,size);
    ctx.strokeStyle = 'rgba(255,255,255,0.50)';
    ctx.lineWidth = 0.9;
    const n = 4;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i*(size/n),0); ctx.lineTo(i*(size/n),size); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0,i*(size/n)); ctx.lineTo(size,i*(size/n)); ctx.stroke();
    }
  } else {
    ctx.fillStyle = darkHex;
    ctx.fillRect(0,0,size,size);
    // Faint diagonal cross so dark squares are never pure black voids
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(size,size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size,0); ctx.lineTo(0,size); ctx.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

/* ============================================================
   COSMIC GLASS THEME  (pure Three.js — no GLSL, no ShaderMaterial)
   ============================================================ */

// Per-layer slab objects built by applyCosmicGlassTheme
const _cgSlabs = [];   // array of { slab, edge, grid } — one entry per layer

// Kept for API compatibility — not used in this implementation
function _makeCgMat() {
  const fb = new THREE.MeshBasicMaterial({ color: 0x00eeff, transparent: true, opacity: 0.10, side: THREE.DoubleSide });
  fb.isCgMat = true;
  return fb;
}

// Build one glass slab + edge glow + grid overlay per layer
function _buildCgSlabs() {
  const boardSize = BOARD * SPACING;   // e.g. 8 * 1.2 = 9.6
  const slabH     = 0.35;             // glass thickness

  for (let z = 0; z < LAYERS; z++) {
    const layer = layers[z];

    // ── Solid semi-transparent glass slab (entire 8×8 area) ──
    const slabGeo = new THREE.BoxGeometry(boardSize, slabH, boardSize);
    const slabMat = new THREE.MeshPhongMaterial({
      color:       0x00eeff,
      emissive:    new THREE.Color(0x001122),
      transparent: true,
      opacity:     0.08,
      side:        THREE.DoubleSide,
      depthWrite:  false
    });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.y = -(slabH / 2);   // flush under the square planes (y=0 in layer space)
    slab.userData.isCgSlab = true;
    layer.add(slab);

    // ── Top-surface border loop — flat at y=0, animates with grid so edges align exactly ──
    const edgePts = [
      new THREE.Vector3(-boardSize / 2, 0, -boardSize / 2),
      new THREE.Vector3( boardSize / 2, 0, -boardSize / 2),
      new THREE.Vector3( boardSize / 2, 0,  boardSize / 2),
      new THREE.Vector3(-boardSize / 2, 0,  boardSize / 2),
    ];
    const edgeMat = new THREE.LineBasicMaterial({
      color:       0x00eeff,
      transparent: true,
      opacity:     0.35,
      linewidth:   1
    });
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(edgePts),
      edgeMat
    );
    // No position offset — y animated same as grid so border coincides with outer grid lines
    edge.userData.isCgEdge = true;
    layer.add(edge);

    // ── Grid lines on top surface of slab (y=0 in geometry; offset via position.y in anim) ──
    const gridPts = [];
    for (let i = 0; i <= BOARD; i++) {
      const pos = -boardSize / 2 + i * SPACING;
      gridPts.push(new THREE.Vector3(-boardSize / 2, 0, pos));
      gridPts.push(new THREE.Vector3( boardSize / 2, 0, pos));
      gridPts.push(new THREE.Vector3(pos, 0, -boardSize / 2));
      gridPts.push(new THREE.Vector3(pos, 0,  boardSize / 2));
    }
    const cgGridMat = new THREE.LineBasicMaterial({
      color:       0x00eeff,
      transparent: true,
      opacity:     0.15,
      linewidth:   1
    });
    const cgGrid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gridPts),
      cgGridMat
    );
    cgGrid.userData.isCgGrid = true;
    layer.add(cgGrid);

    _cgSlabs.push({ slab, edge, grid: cgGrid });
  }
}

// Dispose and remove all glass slabs from their layer groups
function _removeCgSlabs() {
  _cgSlabs.forEach(function(s) {
    if (s.slab.parent) s.slab.parent.remove(s.slab);
    if (s.edge.parent) s.edge.parent.remove(s.edge);
    if (s.grid.parent) s.grid.parent.remove(s.grid);
    s.slab.geometry.dispose(); s.slab.material.dispose();
    s.edge.geometry.dispose(); s.edge.material.dispose();
    s.grid.geometry.dispose(); s.grid.material.dispose();
  });
  _cgSlabs.length = 0;
}

// Set active vs inactive slab opacity/emissive boost
function _updateCgSlabActivity() {
  _cgSlabs.forEach(function(s, i) {
    const isAct = (i === activeZ);
    const op = isAct ? CFG.cosmicGlass.activeOpacity : CFG.cosmicGlass.dimOpacity;
    s.slab.material.opacity = op;
    s.slab.material.emissive.setHex(isAct ? 0x004455 : 0x001122);
    // Edge border and surface grid scale with slab opacity — keep cyan color
    s.edge.material.color.setHex(0x00eeff);
    s.edge.material.opacity = isAct ? Math.min(op * 2.8, 1.0) : Math.min(op * 3.5, 0.6);
    s.grid.material.color.setHex(0x00eeff);
    s.grid.material.opacity = isAct ? Math.min(op * 1.6, 0.8) : Math.min(op * 2.0, 0.35);
  });
}

function applyCosmicGlassTheme() {
  if (cosmicGlassActive) return;
  cosmicGlassActive = true;
  localStorage.setItem('cc_cosmic_glass', '1');
  _cgTime = 0;
  _cgOrigMats = [];   // kept for compat — unused in this implementation

  // Build the glass slabs
  _buildCgSlabs();

  // Active-layer planes: stay visible for raycasting but fully transparent + no depth write
  // Inactive-layer planes: hidden entirely
  for (let z = 0; z < LAYERS; z++) {
    layerPlanes[z].forEach(function(p) {
      if (z === activeZ) {
        p.visible = true;
        p.material.transparent = true; p.material.opacity = 0; p.material.depthWrite = false;
        p.material.needsUpdate = true;
      } else {
        p.visible = false;
      }
    });
  }
  // Hide all regular grid lines immediately
  gridLines.forEach(function(gl) { gl.material.opacity = 0; });

  // Piece colors: white → cyan, black → amber
  // Also auto-pair with Ghost preset if still on default Plastic
  _cgOrigColors = {
    wColor: CFG.pieces.white.color,         bColor: CFG.pieces.black.color,
    wOut:   CFG.pieces.white.outlineColor,  bOut:   CFG.pieces.black.outlineColor,
    wPreset: CFG.pieces.white.materialPreset, bPreset: CFG.pieces.black.materialPreset,
    wHlStyle: CFG.pieces.white.highlightStyle, bHlStyle: CFG.pieces.black.highlightStyle,
  };
  CFG.pieces.white.color        = 0x00ccff;
  CFG.pieces.white.outlineColor = 0x003344;
  CFG.pieces.black.color        = 0xff8800;
  CFG.pieces.black.outlineColor = 0x441800;
  // Default pairing: Ghost pieces for Cosmic Glass board
  if (CFG.pieces.white.materialPreset === 'plastic') {
    CFG.pieces.white.materialPreset = 'ghost';
    CFG.pieces.white.highlightStyle = 'glow';
    CFG.pieces.white.highlightColor = 0x00ccff;
  }
  if (CFG.pieces.black.materialPreset === 'plastic') {
    CFG.pieces.black.materialPreset = 'ghost';
    CFG.pieces.black.highlightStyle = 'glow';
    CFG.pieces.black.highlightColor = 0xff8800;
  }
  applyPieceAppearance();

  _updateCgSlabActivity();
  update();
}

function revertCosmicGlassTheme() {
  if (!cosmicGlassActive) return;
  cosmicGlassActive = false;
  localStorage.setItem('cc_cosmic_glass', '0'); // explicit opt-out; '0' prevents default-on restore

  // Remove glass slabs
  _removeCgSlabs();

  // Restore square-plane materials to non-transparent so update() can use visible-based control
  for (let z = 0; z < LAYERS; z++) {
    layerPlanes[z].forEach(function(p) {
      p.material.transparent = false; p.material.opacity = 1; p.material.depthWrite = true;
      p.material.needsUpdate = true;
    });
  }
  _cgOrigMats = [];

  // Restore piece colors, preset, and opacity
  if (_cgOrigColors) {
    CFG.pieces.white.color         = _cgOrigColors.wColor;
    CFG.pieces.white.outlineColor  = _cgOrigColors.wOut;
    CFG.pieces.black.color         = _cgOrigColors.bColor;
    CFG.pieces.black.outlineColor  = _cgOrigColors.bOut;
    if (_cgOrigColors.wPreset) CFG.pieces.white.materialPreset = _cgOrigColors.wPreset;
    if (_cgOrigColors.bPreset) CFG.pieces.black.materialPreset = _cgOrigColors.bPreset;
    if (_cgOrigColors.wHlStyle) CFG.pieces.white.highlightStyle = _cgOrigColors.wHlStyle;
    if (_cgOrigColors.bHlStyle) CFG.pieces.black.highlightStyle = _cgOrigColors.bHlStyle;
    applyPieceAppearance();
    _cgOrigColors = null;
  }
  update();
}

// Patch update() to keep slab active-state in sync whenever layers change
const _updatePreCG = update;
update = function() {
  _updatePreCG();
  if (!cosmicGlassActive) return;
  _updateCgSlabActivity();
  // Sync square plane states: active layer = transparent+visible for raycasting, others = hidden
  // Hole squares stay invisible on all layers regardless of mode
  for (let z = 0; z < LAYERS; z++) {
    layerPlanes[z].forEach(function(p) {
      if (p.userData.isHole) { p.visible = false; return; }
      if (z === activeZ) {
        p.visible = true;
        p.material.transparent = true; p.material.opacity = 0; p.material.depthWrite = false;
        p.material.needsUpdate = true;
      } else {
        p.visible = false;
      }
    });
  }
  // Hide regular grid lines — cosmic glass uses its own per-slab grid overlay
  gridLines.forEach(function(gl) { gl.material.opacity = 0; });
};

// Wire theme chips (with cosmic-glass support)
document.querySelectorAll('#squareThemeChips .chip').forEach(btn => {
  btn.onclick = () => {
    if (btn.dataset.theme === 'cosmic-glass') {
      applyCosmicGlassTheme();
    } else {
      revertCosmicGlassTheme();
      applySquareTheme(btn.dataset.theme);
    }
    draw2dPreview('pageBoard');
  };
});
// Restore background type (renderer is ready here); set first-load defaults
(function restoreBGType() {
  const saved = localStorage.getItem('cc_bg_type');
  if (!saved) {
    // First-ever load: default to nebula + cosmic glass
    BG.apply('nebula');
    localStorage.setItem('cc_cosmic_glass', '1');
  } else {
    BG.apply(saved);
  }
})();
// Restore Cosmic Glass theme on reload — default ON; only skip if user explicitly opted out ('0')
if (localStorage.getItem('cc_cosmic_glass') !== '0') applyCosmicGlassTheme();

// Wire manual color pickers
const _lsq = document.getElementById('lightSquareColor');
const _dsq = document.getElementById('darkSquareColor');
if (_lsq) _lsq.oninput = () => { rebuildSquareTextures(_lsq.value, _dsq ? _dsq.value : '#050505'); draw2dPreview('pageBoard'); };
if (_dsq) _dsq.oninput = () => { rebuildSquareTextures(_lsq ? _lsq.value : '#2a2a2a', _dsq.value); draw2dPreview('pageBoard'); };

/* ── Layer highlight + smooth opponent move sequence ── */

// Flag read by the timer wrapper to defer player-clock start until
// the full layer-crawl sequence is complete.
let _botLayerAnimActive = false;

const _execBeforeAutoLayer = executeMove;
executeMove = function(piece, t) {
  const wasBotTurn    = (turn === botColor);
  const wasPlayerTurn = !wasBotTurn && botColor;

  // ── Bot move with layer animation enabled ──
  if (wasBotTurn && botColor && !reviewing && UI_PREFS.opponentLayerAnim) {
    const fromZ   = piece.userData.z; // source layer (before move)
    const destZ   = t.z;              // destination layer
    const returnZ = playerLastLayer;  // player's last active layer

    _botLayerAnimActive = true;       // tell timer wrapper to hold

    // Step 1: crawl to the bot piece's source layer so player can watch
    animLayerCrawl(activeZ, fromZ, 120, function() {
      // Step 2: execute the actual move (inner wrappers: timer/threefold/arcade/base)
      //         _execBeforeAutoLayer includes the timer wrapper, which checks
      //         _botLayerAnimActive and will skip startTimer while flag is set.
      _execBeforeAutoLayer.call(null, piece, t);
      // turn has now flipped to player's turn

      // Step 3: wait for piece animation to finish, then follow the piece to destZ
      var ANIM_WAIT = 500; // enough for all piece types (queen float = ~550ms)
      setTimeout(function() {
        // If piece moved to a different layer, update view to follow it
        if (destZ !== activeZ) {
          activeZ = destZ;
          var sl = document.getElementById('zSlider');
          if (sl) sl.value = destZ;
          update(); coords();
        }
        // Activate the cyan layer glow highlight at destination
        _layerHL.active = true; _layerHL.z = destZ;
        _layerHL.opacity = 0; _layerHL.phase = 'in'; _layerHL.t = 0;
        // Brief pause at destination so player clearly sees the completed move
        setTimeout(function() {
          // Step 4: crawl back to player's last layer
          animLayerCrawl(activeZ, returnZ, 120, function() {
            camOnLayerChange();
            _botLayerAnimActive = false;
            // NOW start the player's clock
            if (typeof timeEnabled !== 'undefined' && timeEnabled && !reviewing) {
              if (typeof stopTimer  === 'function') stopTimer();
              if (typeof startTimer === 'function') startTimer(turn);
            }
          });
        }, 350);
      }, ANIM_WAIT);
    });
    return; // early return — base chain called asynchronously above
  }

  // ── Normal path (player move, or anim disabled) ──
  _execBeforeAutoLayer.call(this, piece, t);
  if (!reviewing && wasPlayerTurn) {
    playerLastLayer = t.z;
    // Follow the piece to its destination layer so cross-layer moves are
    // visible — without this the piece silently vanishes from the source layer
    // and the player thinks the move never happened.
    if (t.z !== activeZ) {
      var _destZ = t.z;
      setTimeout(function() {
        if (reviewing) return;
        animLayerCrawl(activeZ, _destZ, 180, function() {
          activeZ = _destZ;
          var sl = document.getElementById('zSlider');
          if (sl) sl.value = activeZ;
          update(); coords(); camOnLayerChange();
        });
      }, 60);
    }
  }
};


// (global bg replaced by #globalBg — always running)

/* ================================================================
   LAYER VISIBILITY — save / load / wire
================================================================ */
function saveLayerVis() {
  try { localStorage.setItem('cc_layer_vis', JSON.stringify(LAYER_VIS)); } catch(e) {}
}
function loadLayerVis() {
  try { var s = JSON.parse(localStorage.getItem('cc_layer_vis') || 'null'); if (s) Object.assign(LAYER_VIS, s); } catch(e) {}
}
loadLayerVis();

(function wireLayerVisSettings() {
  // Mode chips
  document.querySelectorAll('[data-layervis]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.layervis === LAYER_VIS.mode);
    btn.onclick = function() {
      LAYER_VIS.mode = btn.dataset.layervis;
      document.querySelectorAll('[data-layervis]').forEach(function(b) { b.classList.toggle('active', b.dataset.layervis === LAYER_VIS.mode); });
      var row = document.getElementById('layerVisCountRow');
      if (row) row.style.display = LAYER_VIS.mode === 'limited' ? '' : 'none';
      update();
      saveLayerVis();
      // Sync toggle button if visible
      var tbtn = document.getElementById('layerVisToggle');
      if (tbtn) { var labels = { limited:'◈ LTD', current:'◈ CUR', all:'◈ ALL' }; tbtn.textContent = labels[LAYER_VIS.mode]; tbtn.style.color = LAYER_VIS.mode==='all'?'#00ccff':LAYER_VIS.mode==='current'?'#ffaa00':'#aaa'; }
      SND.ui();
    };
  });
  // Count slider
  var slider = document.getElementById('layerVisCount');
  var countLabel = document.getElementById('layerVisCountLabel');
  if (slider) {
    slider.value = LAYER_VIS.count;
    if (countLabel) countLabel.textContent = LAYER_VIS.count;
    slider.oninput = function() {
      LAYER_VIS.count = parseInt(slider.value);
      if (countLabel) countLabel.textContent = LAYER_VIS.count;
      if (LAYER_VIS.mode === 'limited') { update(); saveLayerVis(); }
    };
    slider.onchange = function() { saveLayerVis(); };
  }
  // Hide count row if not in limited mode
  var row = document.getElementById('layerVisCountRow');
  if (row) row.style.display = LAYER_VIS.mode === 'limited' ? '' : 'none';

  // Layer gap slider
  (function() {
    var lsSlider = document.getElementById('layerSpacingSlider');
    var lsLabel  = document.getElementById('layerSpacingLabel');
    var stored = parseFloat(localStorage.getItem('cc_layer_spacing'));
    if (!isNaN(stored) && stored >= 1.2 && stored <= 4.0) {
      LAYER_SPACING = stored;
      // The board was already built at the default spacing — re-place the layers
      // to the saved gap, otherwise the board stays at default while everything
      // computed from LAYER_SPACING drifts a layer off.
      if (typeof rebuildLayerPositions === 'function') rebuildLayerPositions();
    }
    if (lsSlider) {
      lsSlider.value = Math.round(LAYER_SPACING * 10);
      if (lsLabel) lsLabel.textContent = LAYER_SPACING.toFixed(1);
      lsSlider.oninput = function() {
        LAYER_SPACING = parseInt(lsSlider.value) / 10;
        if (lsLabel) lsLabel.textContent = LAYER_SPACING.toFixed(1);
        rebuildLayerPositions();
        localStorage.setItem('cc_layer_spacing', LAYER_SPACING);
      };
    }
  })();
})();

/* ================================================================
   STYLE SETTINGS — Save/Cancel/Default + live preview canvas
================================================================ */

// ── CFG snapshot for Cancel ──
let _cfgSnapshot = null;

function snapshotCFG() {
  _cfgSnapshot = JSON.parse(JSON.stringify(CFG));
}
function restoreCFG() {
  if (!_cfgSnapshot) return;
  const S = _cfgSnapshot;
  Object.assign(CFG.hl.legal,    S.hl.legal);
  Object.assign(CFG.hl.threats,  S.hl.threats);
  Object.assign(CFG.hl.lastMove, S.hl.lastMove);
  Object.assign(CFG.hl.selection,S.hl.selection);
  Object.assign(CFG.grid,        S.grid);
  Object.assign(CFG.cosmicGlass, S.cosmicGlass);
  Object.assign(CFG.pieces.white,S.pieces.white);
  Object.assign(CFG.pieces.black,S.pieces.black);
  if (S.piecePresetSlots) CFG.piecePresetSlots = S.piecePresetSlots.slice();
  // Sync UI controls to restored values
  syncAllSettingsUI();
  applyPieceAppearance();
  update();
  refreshLegalMoveHighlights();
  refreshThreatHighlights();
  refreshLastMove();
}

function resetCFGToDefault() {
  const D = {
    hl:{
      legal:    {on:true, color:0xffffff, opacity:0.32},
      threats:  {on:true, color:0xff3333, opacity:0.35},
      lastMove: {on:true, color:0x44aaff, opacity:0.50},
      selection:{on:true, color:0xffffff, opacity:0.75}
    },
    grid:{activeColor:0xffffff,activeOpacity:0.60,dimColor:0xffffff,dimOpacity:0.05,thickness:1},
    cosmicGlass:{activeOpacity:0.25,dimOpacity:0.08},
    bg:{color:'#000000'},
    pieces:{
      white:{color:0xffffff,outlineColor:0x888888,outlineSelColor:0x00ffff,thickness:0.038,
             materialPreset:'plastic',baseOpacity:0.9,emissiveColor:0x000000,emissiveIntensity:0.0,roughness:0.4,highlightStyle:'outline',highlightColor:0x888888,useGLB:true},
      black:{color:0x555555,outlineColor:0x222222,outlineSelColor:0xff5500,thickness:0.038,
             materialPreset:'plastic',baseOpacity:0.9,emissiveColor:0x000000,emissiveIntensity:0.0,roughness:0.4,highlightStyle:'outline',highlightColor:0x222222,useGLB:true}
    }
  };
  Object.assign(CFG.hl.legal,     D.hl.legal);
  Object.assign(CFG.hl.threats,   D.hl.threats);
  Object.assign(CFG.hl.lastMove,  D.hl.lastMove);
  Object.assign(CFG.hl.selection, D.hl.selection);
  Object.assign(CFG.grid,         D.grid);
  Object.assign(CFG.cosmicGlass,  D.cosmicGlass);
  Object.assign(CFG.pieces.white, D.pieces.white);
  Object.assign(CFG.pieces.black, D.pieces.black);
  CFG.piecePresetSlots = [null,null,null,null];
  syncAllSettingsUI();
  applyPieceAppearance(); update();
  refreshLegalMoveHighlights(); refreshThreatHighlights(); refreshLastMove();
}

function syncAllSettingsUI() {
  // Sync all settings controls to current CFG
  const set = (id, val) => { const el=document.getElementById(id); if(el)el.value=val; };
  const chk = (id, val) => { const el=document.getElementById(id); if(el)el.checked=val; };
  set('whitePieceColor',       intToHex(CFG.pieces.white.color));
  set('whiteOutlineColor',     intToHex(CFG.pieces.white.outlineColor));
  set('whiteOutlineSelColor',  intToHex(CFG.pieces.white.outlineSelColor));
  set('whiteOutlineThickness', Math.round(CFG.pieces.white.thickness * 100));
  set('blackPieceColor',       intToHex(CFG.pieces.black.color));
  set('blackOutlineColor',     intToHex(CFG.pieces.black.outlineColor));
  set('blackOutlineSelColor',  intToHex(CFG.pieces.black.outlineSelColor));
  set('blackOutlineThickness', Math.round(CFG.pieces.black.thickness * 100));
  chk('hlLegal',   CFG.hl.legal.on);    set('hlLegalColor',    intToHex(CFG.hl.legal.color));    set('hlLegalOpacity',    Math.round(CFG.hl.legal.opacity*100));
  chk('hlThreats', CFG.hl.threats.on);  set('hlThreatsColor',  intToHex(CFG.hl.threats.color));  set('hlThreatsOpacity',  Math.round(CFG.hl.threats.opacity*100));
  chk('hlLastMove',CFG.hl.lastMove.on); set('hlLastMoveColor', intToHex(CFG.hl.lastMove.color)); set('hlLastMoveOpacity', Math.round(CFG.hl.lastMove.opacity*100));
  chk('hlSelection',CFG.hl.selection.on);set('hlSelectionColor',intToHex(CFG.hl.selection.color));set('hlSelectionOpacity',Math.round(CFG.hl.selection.opacity*100));
  set('gridActiveColor',   intToHex(CFG.grid.activeColor));
  set('gridActiveOpacity', Math.round(CFG.grid.activeOpacity*100));
  set('gridDimColor',      intToHex(CFG.grid.dimColor));
  set('gridDimOpacity',    Math.round(CFG.grid.dimOpacity*100));
  set('gridThickness',     CFG.grid.thickness);
  set('cgActiveOpacity',   Math.round(CFG.cosmicGlass.activeOpacity * 100));
  set('cgDimOpacity',      Math.round(CFG.cosmicGlass.dimOpacity * 100));
  // Sync background pickers in both tabs
  set('bgColor',  BG.color);
  set('bBgColor', BG.color);
  set('bgStarColor',    BG.starColor);
  set('bBgStarColor',   BG.starColor);
  set('bgNebulaColor',  BG.nebulaAccentColor);
  set('bBgNebulaColor', BG.nebulaAccentColor);
  document.querySelectorAll('[data-bg]').forEach(b => b.classList.toggle('active', b.dataset.bg === BG.type));
  // Sync star/nebula color row visibility
  document.querySelectorAll('.bgStarColorRow').forEach(function(el){el.style.display=(BG.type==='stars'||BG.type==='nebula')?'':'none';});
  document.querySelectorAll('.bgNebulaColorRow').forEach(function(el){el.style.display=BG.type==='nebula'?'':'none';});
  // Sync basic tab piece colour pickers
  set('bWhitePieceColor', intToHex(CFG.pieces.white.color));
  set('bBlackPieceColor', intToHex(CFG.pieces.black.color));
  // Sync basic tab interface toggles
  chk('bLegalMoves', CFG.hl.legal.on);
  chk('bThreats',    CFG.hl.threats.on);
  if (typeof UI_PREFS !== 'undefined') chk('bCoords', UI_PREFS.coords);
  // Sync appearance panel
  if (typeof syncAppearancePanelUI === 'function') syncAppearancePanelUI();
}

// ── Save / Cancel / Default buttons ──
document.getElementById('sfSave').onclick = () => {
  SND.confirm();
  saveCFGToStorage();
  _cfgSnapshot = null;
  document.getElementById('settingsOverlay').style.display = 'none';
  if (typeof _settingsOrigin !== 'undefined' && _settingsOrigin !== 'pauseMenu') {
    document.getElementById(_settingsOrigin).style.display = 'flex';
  }
  stopPiecePreview();
};
document.getElementById('sfCancel').onclick = () => {
  SND.ui();
  restoreCFG();
  document.getElementById('settingsOverlay').style.display = 'none';
  if (typeof _settingsOrigin !== 'undefined' && _settingsOrigin !== 'pauseMenu') {
    document.getElementById(_settingsOrigin).style.display = 'flex';
  }
  stopPiecePreview();
};
document.getElementById('sfDefault').onclick = () => {
  SND.ui();
  resetCFGToDefault();
  drawSettingsPreview(typeof _currentPreviewPage==='function' ? _currentPreviewPage() : 'pagePieces');
};

// Also snapshot when opening settings
const _origOpenSettings = document.getElementById('closeSettings').onclick;
// Hook the settings overlay display (patch settingsBtn and mainSettingsBtn)
function openSettingsWithSnapshot() {
  snapshotCFG();
  syncAllSettingsUI();
  // Determine what to preview: if BASIC tab active show piece preview, else use advTab
  const topTab = document.querySelector('.stTab.active');
  if (topTab && topTab.dataset.page === 'pageAdvanced') {
    const advTab = document.querySelector('.advTab.active');
    drawSettingsPreview(advTab ? advTab.dataset.adv : 'pagePieces');
  } else {
    drawSettingsPreview('pagePieces');
  }
}

/* ================================================================
   PIECE PREVIEW — industry-standard implementation
   
   Architecture:
   - ONE WebGLRenderer, created once, NEVER disposed (avoids context loss)
   - RAF stopped on close, restarted on open
   - Scene rebuilt on each open (fresh piece + correct colors)
   - Pivot Group centred on piece bounding-box midpoint → correct Y-axis spin
   - Pointer + touch drag; auto-spin resumes 1.2 s after release
================================================================ */

const PREV_TYPES = ['pawn','knight','bishop','rook','queen','king'];
let _prevIdx     = 0;
let _prevRafId   = null;
let _prevSpin    = true;
let _prevDrag    = false;
let _prevLastX   = 0;

// Persistent objects — created once
let _prevRenderer = null;
let _prevScene    = null;
let _prevCam      = null;
let _prevPivot    = null;  // Group that rotates
let _prevMesh     = null;  // current piece Group inside pivot

/* ── One-time renderer + scene init ── */
function _initPreviewRenderer() {
  const canvas = document.getElementById('previewCanvas');
  // On mobile: skip 3D preview to avoid a second concurrent WebGL context.
  // Mobile browsers cap WebGL contexts (often 2 total) — the main renderer
  // must keep its context healthy. Hide the 3D canvas and rely on 2D fallback.
  if (!canvas || _prevRenderer || IS_MOBILE) return;

  _prevRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  _prevRenderer.setClearColor(0x000000, 0);
  _prevRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _prevRenderer.setSize(110, 130, false);  // updateStyle=false: CSS handles display size

  _prevScene = new THREE.Scene();

  _prevCam = new THREE.PerspectiveCamera(38, 110/130, 0.01, 20);
  _prevCam.position.set(0, 0, 2.2);
  _prevCam.lookAt(0, 0, 0);

  // Lighting tuned for MeshPhongMaterial
  const key  = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 4, 3);
  _prevScene.add(key);

  const fill = new THREE.DirectionalLight(0x6699ff, 0.5);
  fill.position.set(-3, 2, -2);
  _prevScene.add(fill);

  const rim  = new THREE.DirectionalLight(0x00ccff, 0.35);
  rim.position.set(0, -2, -3);
  _prevScene.add(rim);

  _prevScene.add(new THREE.AmbientLight(0xffffff, 0.18));

  _prevPivot = new THREE.Group();
  _prevScene.add(_prevPivot);

  // Wire drag events once
  _wirePrevDrag(canvas);
}

/* ── Build a piece with appearance-system materials for the preview ── */
function _buildPrevMesh(type) {
  let g;
  // Use GLB geometry if available
  if (_glbUseModels && _glbLoadDone && GLB_MODELS[type] && GLB_MODELS[type].length > 0) {
    g = new THREE.Group();
    GLB_MODELS[type].forEach(({ geo, matrix }) => {
      const m = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial());
      m.applyMatrix4(matrix);
      g.add(m);
    });
  } else {
    const builders = { pawn, knight, bishop, rook, queen, king };
    g = builders[type]('white');
    // Strip glow/highlight sprites (mess with preview bounding box)
    const toRm = [];
    g.traverse(o => { if (o.userData.isGlow || o.userData.isHighlightEffect) toRm.push(o); });
    toRm.forEach(o => { if (o.parent) o.parent.remove(o); });
  }

  const wCfg = CFG.pieces.white;
  g.traverse(obj => {
    if (!obj.isMesh) return;
    const isOutline = obj.userData.isOutline;
    obj.material = isOutline
      ? new THREE.MeshPhongMaterial({
          color: wCfg.highlightColor !== undefined ? wCfg.highlightColor : (wCfg.outlineColor || 0x888888),
          shininess: 0, side: THREE.BackSide,
        })
      : buildPieceMaterial(wCfg, false);
  });

  // Centre on bounding-box midpoint so pivot Y-rotation is correct
  const box = new THREE.Box3().setFromObject(g);
  const mid = new THREE.Vector3();
  box.getCenter(mid);
  g.position.sub(mid);   // shift piece so its centre is at pivot origin

  // Scale to fill the canvas nicely
  const size = new THREE.Vector3();
  box.getSize(size);
  const tallest = Math.max(size.x, size.y, size.z);
  const targetH = 0.80;  // fill ~80% of view height
  g.scale.setScalar(targetH / tallest);

  return g;
}

/* ── Swap piece in the pivot ── */
function _loadPrevPiece(type) {
  if (!_prevPivot) return;

  // Remove + dispose old mesh
  if (_prevMesh) {
    _prevPivot.remove(_prevMesh);
    _prevMesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach(m => m.dispose());
    });
    _prevMesh = null;
  }

  _prevMesh = _buildPrevMesh(type);
  _prevPivot.add(_prevMesh);
  _prevPivot.rotation.y = 0.4;  // start at slight angle

  const el = document.getElementById('previewLabel');
  if (el) el.textContent = type.toUpperCase();
}

/* ── RAF render loop ── */
function _startPrevLoop() {
  if (_prevRafId) cancelAnimationFrame(_prevRafId);
  (function tick() {
    _prevRafId = requestAnimationFrame(tick);
    if (!_prevRenderer || !_prevScene || !_prevCam) return;
    if (_prevSpin && !_prevDrag && _prevPivot) _prevPivot.rotation.y += 0.013;
    _prevRenderer.render(_prevScene, _prevCam);
  })();
}

function _stopPrevLoop() {
  if (_prevRafId) { cancelAnimationFrame(_prevRafId); _prevRafId = null; }
}

/* ── Pointer + touch drag ── */
function _wirePrevDrag(canvas) {
  function onDown(x) { _prevDrag = true; _prevLastX = x; _prevSpin = false; }
  function onMove(x) {
    if (!_prevDrag || !_prevPivot) return;
    _prevPivot.rotation.y += (x - _prevLastX) * 0.025;
    _prevLastX = x;
  }
  function onUp() {
    _prevDrag = false;
    setTimeout(() => { _prevSpin = true; }, 1200);
  }

  canvas.addEventListener('pointerdown',   e => { e.preventDefault(); onDown(e.clientX); try { canvas.setPointerCapture(e.pointerId); } catch(_){} }, { passive: false });
  canvas.addEventListener('pointermove',   e => { e.preventDefault(); onMove(e.clientX); }, { passive: false });
  canvas.addEventListener('pointerup',     () => onUp());
  canvas.addEventListener('pointercancel', () => { _prevDrag = false; });
  canvas.addEventListener('touchstart',    e => { e.preventDefault(); onDown(e.touches[0].clientX); }, { passive: false });
  canvas.addEventListener('touchmove',     e => { e.preventDefault(); onMove(e.touches[0].clientX); }, { passive: false });
  canvas.addEventListener('touchend',      () => onUp(), { passive: true });
}

/* ── Public API ── */

// Called when settings opens or switches to Pieces tab
function startPiecePreview() {
  if (IS_MOBILE) return; // second WebGL context avoided on mobile
  _initPreviewRenderer();     // no-op if already created
  _loadPrevPiece(PREV_TYPES[_prevIdx]);
  _prevSpin = true;
  _startPrevLoop();
}

// Called when settings closes (any button)
function stopPiecePreview() {
  _stopPrevLoop();
  // Do NOT dispose renderer — context re-creation is unreliable
}

// Called on every tab switch and settings open
function drawSettingsPreview(page) {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay || overlay.style.display === 'none') return;

  // Normalise: pageBasic shows piece preview too
  const effectivePage = (!page || page === 'pageBasic') ? 'pagePieces' : page;
  const isPieces = (effectivePage === 'pagePieces');
  const panel    = document.getElementById('settingsPreview');
  const canvas3d = document.getElementById('previewCanvas');
  const canvas2d = document.getElementById('previewCanvas2d');
  const navBtns  = document.getElementById('previewNavBtns');

  if (panel)   panel.style.display   = 'flex';
  if (canvas3d) canvas3d.style.display = isPieces ? 'block' : 'none';
  if (canvas2d) canvas2d.style.display = isPieces ? 'none'  : 'block';
  if (navBtns)  navBtns.style.display  = isPieces ? 'flex'  : 'none';

  if (isPieces) {
    /* _initPreviewRenderer() refuses to build a second WebGL context on mobile
       (browsers cap them, and the board's context is the one that matters), and
       its comment says to "rely on 2D fallback" — but draw2dPreview() never had
       a pieces branch, so on every phone this panel was an empty box with a
       PAWN label and two arrows that changed nothing. Route mobile to the 2D
       silhouette instead of a canvas nothing ever draws into. */
    if (IS_MOBILE) {
      if (canvas3d) canvas3d.style.display = 'none';
      if (canvas2d) canvas2d.style.display = 'block';
      draw2dPieces();
      return;
    }
    // Only restart if not already running — avoids flicker when settings controls fire change events
    if (!_prevRafId) {
      requestAnimationFrame(() => requestAnimationFrame(startPiecePreview));
    }
  } else {
    stopPiecePreview();
    draw2dPreview(effectivePage);
  }
}

/* ── 2D piece silhouettes ── the mobile stand-in for the 3D preview ────────
   Outlines only, at the configured colours, so the panel previews what it is
   actually there to preview: base colour, outline colour and outline
   thickness. Coordinates are in a 0..1 box scaled to the canvas, so the same
   path data works at any preview size. */
const PREV_2D_SHAPES = {
  pawn:   [[0.50,0.20,0.105],  null, [[0.375,0.315],[0.625,0.315],[0.585,0.53],[0.415,0.53]]],
  knight: [null, null, [[0.34,0.80],[0.34,0.60],[0.40,0.44],[0.35,0.36],[0.42,0.245],[0.55,0.175],
                        [0.66,0.22],[0.71,0.35],[0.70,0.52],[0.62,0.62],[0.60,0.80]]],
  bishop: [[0.50,0.185,0.075], null, [[0.40,0.30],[0.60,0.30],[0.575,0.56],[0.425,0.56]]],
  rook:   [null, null, [[0.35,0.215],[0.415,0.215],[0.415,0.28],[0.472,0.28],[0.472,0.215],
                        [0.528,0.215],[0.528,0.28],[0.585,0.28],[0.585,0.215],[0.65,0.215],
                        [0.62,0.40],[0.62,0.56],[0.38,0.56],[0.38,0.40]]],
  queen:  [null, [[0.32,0.20],[0.385,0.34],[0.435,0.175],[0.50,0.33],[0.565,0.175],
                  [0.615,0.34],[0.68,0.20],[0.635,0.56],[0.365,0.56]], null],
  king:   [null, null, [[0.385,0.24],[0.47,0.24],[0.47,0.155],[0.53,0.155],[0.53,0.24],
                        [0.615,0.24],[0.645,0.36],[0.60,0.44],[0.625,0.56],[0.375,0.56],
                        [0.40,0.44],[0.355,0.36]]]
};

function draw2dPieces() {
  const c = document.getElementById('previewCanvas2d');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);

  const type  = PREV_TYPES[_prevIdx] || 'pawn';
  const shape = PREV_2D_SHAPES[type] || PREV_2D_SHAPES.pawn;
  const cfg   = CFG.pieces.white;
  const fill    = intToHex(cfg.color);
  const stroke  = intToHex(cfg.outlineColor);
  // The 3D outline is a shell scaled off the mesh; on a flat silhouette the
  // equivalent is line width, mapped over the same slider range.
  const lw = Math.max(1, Math.min(6, (cfg.thickness || 0.038) * 90));

  const S = Math.min(W, H);
  const px = v => v * S + (W - S) / 2;
  const py = v => v * S + (H - S) / 2;

  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;

  const [head, crown, body] = shape;
  const poly = pts => {
    ctx.beginPath();
    pts.forEach((pt, i) => (i ? ctx.lineTo(px(pt[0]), py(pt[1])) : ctx.moveTo(px(pt[0]), py(pt[1]))));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  };
  /* Order matters: each shape is filled opaque, so a later one hides the
     outline of the earlier one it overlaps. The stem goes down first and the
     body and base are laid over its ends, which is what makes the three read
     as one turned piece instead of three stacked cut-outs. */
  poly([[0.435,0.46],[0.565,0.46],[0.60,0.72],[0.40,0.72]]);   // stem
  if (head)  { ctx.beginPath(); ctx.arc(px(head[0]), py(head[1]), head[2] * S, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  if (crown) poly(crown);
  if (body)  poly(body);
  // Shared base — every piece stands on the same plinth.
  poly([[0.30,0.815],[0.70,0.815],[0.62,0.63],[0.38,0.63]]);

  const label = document.getElementById('previewLabel');
  if (label) label.textContent = type.toUpperCase();
}

// 2D live preview for non-Pieces tabs
function draw2dPreview(page) {
  const c = document.getElementById('previewCanvas2d');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);

  const label = document.getElementById('previewLabel');

  if (page === 'pageBoard') {
    const lightHex = document.getElementById('lightSquareColor')?.value || '#2a2a2a';
    const darkHex  = document.getElementById('darkSquareColor')?.value  || '#050505';
    const gridHex  = intToHex(CFG.grid.activeColor);
    const gR = parseInt(gridHex.slice(1,3),16), gG = parseInt(gridHex.slice(3,5),16), gB = parseInt(gridHex.slice(5,7),16);
    const sq = (Math.min(W,H) - 10) / 8;
    const ox = (W - sq*8)/2, oy = (H - sq*8)/2;
    for (let r=0;r<8;r++) for (let col=0;col<8;col++) {
      ctx.fillStyle = (r+col)%2===0 ? lightHex : darkHex;
      ctx.fillRect(ox+col*sq, oy+r*sq, sq, sq);
    }
    ctx.strokeStyle = `rgba(${gR},${gG},${gB},${CFG.grid.activeOpacity})`;
    ctx.lineWidth = CFG.grid.thickness * 0.5;
    ctx.beginPath();
    for (let i=0;i<=8;i++) {
      ctx.moveTo(ox+i*sq, oy); ctx.lineTo(ox+i*sq, oy+8*sq);
      ctx.moveTo(ox, oy+i*sq); ctx.lineTo(ox+8*sq, oy+i*sq);
    }
    ctx.stroke();
    if (label) label.textContent = 'BOARD';

  } else if (page === 'pageHighlights') {
    const sq = (Math.min(W,H) - 10) / 8;
    const ox = (W - sq*8)/2, oy = (H - sq*8)/2;
    for (let r=0;r<8;r++) for (let col=0;col<8;col++) {
      ctx.fillStyle = (r+col)%2===0 ? '#2a2a2a' : '#050505';
      ctx.fillRect(ox+col*sq, oy+r*sq, sq, sq);
    }
    const hl = (r, col, color, op) => {
      const h = intToHex(color);
      ctx.fillStyle = `rgba(${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)},${op})`;
      ctx.fillRect(ox+col*sq, oy+r*sq, sq, sq);
    };
    if (CFG.hl.selection.on) hl(3,3, CFG.hl.selection.color, CFG.hl.selection.opacity);
    if (CFG.hl.legal.on)     hl(2,2, CFG.hl.legal.color,     CFG.hl.legal.opacity);
    if (CFG.hl.legal.on)     hl(4,4, CFG.hl.legal.color,     CFG.hl.legal.opacity);
    if (CFG.hl.lastMove.on)  hl(5,1, CFG.hl.lastMove.color,  CFG.hl.lastMove.opacity*0.5);
    if (CFG.hl.lastMove.on)  hl(5,2, CFG.hl.lastMove.color,  CFG.hl.lastMove.opacity);
    if (CFG.hl.threats.on)   hl(1,5, CFG.hl.threats.color,   CFG.hl.threats.opacity);
    if (label) label.textContent = 'HIGHLIGHTS';

  } else if (page === 'pageBackground') {
    const type = BG.type;
    if (type === 'solid') {
      ctx.fillStyle = BG.color;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(0,200,255,0.18)';
      ctx.lineWidth = 0.5; ctx.beginPath();
      for (let i=0;i<=5;i++) {
        ctx.moveTo(i*W/5,0); ctx.lineTo(i*W/5,H);
        ctx.moveTo(0,i*H/5); ctx.lineTo(W,i*H/5);
      }
      ctx.stroke();
    } else if (type === 'stars' || type === 'nebula') {
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
      for (let i=0;i<50;i++) {
        const sx=(Math.sin(i*127.1)*0.5+0.5)*W, sy=(Math.sin(i*311.7)*0.5+0.5)*H;
        const sr=Math.abs(Math.sin(i*74.3))*1.2+0.3;
        ctx.fillStyle = type==='nebula'
          ? `rgba(${80+(Math.sin(i)*80)|0},${(100+Math.cos(i)*80)|0},255,0.8)`
          : `rgba(200,220,255,${0.3+Math.abs(Math.sin(i*2))*0.5})`;
        ctx.beginPath(); ctx.arc(sx,sy,sr,0,Math.PI*2); ctx.fill();
      }
    } else if (type === 'grid') {
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle = 'rgba(0,200,255,0.35)'; ctx.lineWidth=0.5; ctx.beginPath();
      for (let i=0;i<=8;i++) {
        ctx.moveTo(i*W/8,0); ctx.lineTo(i*W/8,H);
        ctx.moveTo(0,i*H/8); ctx.lineTo(W,i*H/8);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle='#111'; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle='#2a2a2a'; ctx.lineWidth=1; ctx.strokeRect(8,8,W-16,H-16);
      ctx.fillStyle='#333'; ctx.font='8px monospace'; ctx.textAlign='center';
      ctx.textBaseline='middle'; ctx.fillText('PHOTO',W/2,H/2);
    }
    if (label) label.textContent = 'BACKGROUND';

  } else if (page === 'pageMessages') {
    const msg = MSGS[activeMsgKey] || MSGS.start;
    const fs  = Math.max(8, Math.min(18, msg.size / 6));
    ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    if (msg.glow) { ctx.shadowColor=msg.color; ctx.shadowBlur=10; }
    ctx.fillStyle = msg.color;
    ctx.fillText(msg.text, W/2, H/2);
    ctx.shadowBlur=0;
    ctx.fillStyle='#333'; ctx.font='7px monospace';
    ctx.fillText(msg.anim.toUpperCase(), W/2, H*0.72);
    if (label) label.textContent = 'MESSAGE';

  } else if (page === 'pageSound') {
    const on  = document.getElementById('soundOn')?.checked ?? true;
    const vol = parseInt(document.getElementById('masterVolume')?.value ?? 60)/100;
    const bars=12, bw=W/(bars*1.8), maxH=H*0.55;
    ctx.fillStyle = on ? `rgba(0,200,255,${0.25+vol*0.55})` : '#1a1a1a';
    for (let i=0;i<bars;i++) {
      const bh = maxH*(0.15+Math.abs(Math.sin(i*0.85))*0.85)*(on?vol:0.1);
      const bx = W/2-(bars/2*bw*1.8)+i*bw*1.8;
      ctx.fillRect(bx, H/2-bh/2, bw, bh);
    }
    ctx.fillStyle='#333'; ctx.font='7px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(on?`VOL ${Math.round(vol*100)}%`:'MUTED', W/2, H*0.78);
    if (label) label.textContent = 'SOUND';
  }
}

// Called by nav buttons and settings changes
function previewPiece(type) {
  if (IS_MOBILE) { draw2dPieces(); return; }   // no 3D context on phones
  _loadPrevPiece(type);
}

// Refresh piece colors after CFG change
function _refreshPreviewColors() {
  if (IS_MOBILE) { draw2dPieces(); return; }
  if (!_prevMesh) return;
  const wColor   = CFG.pieces.white.color;
  const wOutline = CFG.pieces.white.outlineColor;
  _prevMesh.traverse(obj => {
    if (!obj.isMesh || !obj.material || !obj.material.isMeshPhongMaterial) return;
    obj.material.color.setHex(obj.userData.isOutline ? wOutline : wColor);
  });
}

/* ── Piece nav buttons ── */
;(function wirePieceNav() {
  const prev = document.getElementById('prevPieceBtn');
  const next = document.getElementById('nextPieceBtn');
  if (prev) prev.addEventListener('click', () => {
    _prevIdx = (_prevIdx - 1 + PREV_TYPES.length) % PREV_TYPES.length;
    previewPiece(PREV_TYPES[_prevIdx]);
    _prevSpin = true;
  });
  if (next) next.addEventListener('click', () => {
    _prevIdx = (_prevIdx + 1) % PREV_TYPES.length;
    previewPiece(PREV_TYPES[_prevIdx]);
    _prevSpin = true;
  });
})();

/* ── Live color refresh on settings controls change ── */
function _currentPreviewPage() {
  const topTab = document.querySelector('.stTab.active');
  if (topTab && topTab.dataset.page === 'pageAdvanced') {
    const adv = document.querySelector('.advTab.active');
    return adv ? adv.dataset.adv : 'pagePieces';
  }
  return 'pagePieces';
}
['input', 'change'].forEach(evt =>
  document.getElementById('settingsControls').addEventListener(evt, () => {
    drawSettingsPreview(_currentPreviewPage());
    _refreshPreviewColors();
  })
);
document.getElementById('settingsControls').addEventListener('click', () => {
  setTimeout(() => { drawSettingsPreview(_currentPreviewPage()); }, 30);
});

/* ── Settings open hooks — single source of truth ── */
// Patch settingsBtn (in-game pause)
const _origSettingsBtn = document.getElementById('settingsBtn').onclick;
document.getElementById('settingsBtn').onclick = function() {
  if (_origSettingsBtn) _origSettingsBtn.call(this);
  snapshotCFG();
  syncAllSettingsUI();
  drawSettingsPreview('pagePieces');
};

// Patch mainSettingsBtn (from main menu)
const _origMainSettingsBtn = document.getElementById('mainSettingsBtn').onclick;
document.getElementById('mainSettingsBtn').onclick = function() {
  SND.ui();
  document.getElementById('mainMenu').style.display = 'none';
  _settingsOrigin = 'mainMenu';
  document.getElementById('settingsOverlay').style.display = 'flex';
  snapshotCFG();
  syncAllSettingsUI();
  drawSettingsPreview('pagePieces');
};

/* ================================================================
   FEATURES BLOCK — all suggestions + arcade tweaks
================================================================ */

/* ── 1. COLOUR BLINDNESS ACCESSIBILITY PRESETS ── */
const A11Y_PRESETS = {
  deuteranopia: { // red-green (most common)
    white: { color: 0xf5f0d8, outlineColor: 0xd4b000, outlineSelColor: 0x0077bb },
    black: { color: 0x1155aa, outlineColor: 0x003377, outlineSelColor: 0xff8800 },
    legal: 0x0077ff, threat: 0xff8800
  },
  protanopia: { // red blind
    white: { color: 0xf8f4e0, outlineColor: 0xccaa00, outlineSelColor: 0x0099cc },
    black: { color: 0x005588, outlineColor: 0x003366, outlineSelColor: 0xffcc00 },
    legal: 0x00aaff, threat: 0xffcc00
  },
  tritanopia: { // blue-yellow
    white: { color: 0xffffff, outlineColor: 0xff6688, outlineSelColor: 0x00cc88 },
    black: { color: 0xcc2244, outlineColor: 0x880022, outlineSelColor: 0x00ffaa },
    legal: 0x00ffaa, threat: 0xff2244
  },
  highcontrast: {
    white: { color: 0xffffff, outlineColor: 0xffff00, outlineSelColor: 0x00ffff },
    black: { color: 0xff0000, outlineColor: 0xff8800, outlineSelColor: 0xffff00 },
    legal: 0xffff00, threat: 0xff00ff
  },
  none: null // reset to current CFG
};

function applyA11yPreset(key) {
  const p = A11Y_PRESETS[key];
  if (!p) {
    // Reset to defaults
    resetCFGToDefault();
    return;
  }
  CFG.pieces.white.color         = p.white.color;
  CFG.pieces.white.outlineColor  = p.white.outlineColor;
  CFG.pieces.white.outlineSelColor = p.white.outlineSelColor;
  CFG.pieces.black.color         = p.black.color;
  CFG.pieces.black.outlineColor  = p.black.outlineColor;
  CFG.pieces.black.outlineSelColor = p.black.outlineSelColor;
  if (p.legal)  CFG.hl.legal.color   = p.legal;
  if (p.threat) CFG.hl.threats.color = p.threat;
  applyPieceColors();
  syncAllSettingsUI();
  refreshLegalMoveHighlights();
  refreshThreatHighlights();
  update();
}

document.querySelectorAll('[data-a11y]').forEach(btn => {
  btn.onclick = () => {
    SND.ui();
    applyA11yPreset(btn.dataset.a11y);
    document.querySelectorAll('[data-a11y]').forEach(b =>
      b.classList.toggle('active', b.dataset.a11y === btn.dataset.a11y)
    );
    drawSettingsPreview(_currentPreviewPage());
  };
});

/* ── 2. MOVE TRAILS — THREE.js fade ghosts along piece path ── */
UI_PREFS.trails = true;
const trailGroup = new THREE.Group();
scene.add(trailGroup);
let trailParticles = []; // [{mesh, life, maxLife}]

function spawnTrail(fromWorld, toWorld, color) {
  if (!UI_PREFS.trails) return;
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const pos = new THREE.Vector3().lerpVectors(fromWorld, toWorld, t);
    const geo = new THREE.SphereGeometry(0.06 + t * 0.08, 5, 5);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.5 * (1 - t)
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    trailGroup.add(mesh);
    trailParticles.push({ mesh, life: 1.0, maxLife: 1.0, decay: 0.04 + t * 0.02 });
  }
}

function updateTrails() {
  for (let i = trailParticles.length - 1; i >= 0; i--) {
    const p = trailParticles[i];
    p.life -= p.decay;
    p.mesh.material.opacity = Math.max(0, p.life * 0.5);
    if (p.life <= 0) {
      trailGroup.remove(p.mesh);
      trailParticles.splice(i, 1);
    }
  }
}

// Wire trail toggle
applyUIPref._orig = applyUIPref;
const _prevApplyUIPref = applyUIPref;
// extend applyUIPref to handle 'trails'
const _applyUIPrefWrapped = function(key, val) {
  _prevApplyUIPref(key, val);
  if (key === 'trails') {
    if (!val) { trailGroup.clear(); trailParticles = []; }
  }
};
// Replace the function reference globally
Object.keys(UI_PREFS).forEach(key => {
  const row = document.getElementById('uiToggle_' + key);
  if (!row) return;
  row.onclick = () => _applyUIPrefWrapped(key, !UI_PREFS[key]);
});

// Hook executeMove to spawn trails
const _execBeforeTrails = executeMove;
executeMove = function(piece, t) {
  const from3 = piece.parent
    ? new THREE.Vector3().setFromMatrixPosition(piece.matrixWorld)
    : null;
  _execBeforeTrails.call(this, piece, t);
  // Spawn trail after move (piece is now at destination)
  if (from3 && UI_PREFS.trails) {
    const color = piece.userData.color === 'white'
      ? CFG.pieces.white.color
      : CFG.pieces.black.color;
    const to3 = new THREE.Vector3().setFromMatrixPosition(piece.matrixWorld);
    spawnTrail(from3, to3, color);
  }
};

/* ── 3. NOTATION OVERLAY — 3D square labels directly on board ── */
// Accessible via UI/Controls toggle 'notation3d'
UI_PREFS.notation3d = false;
const notation3dGroup = new THREE.Group();
notation3dGroup.visible = false;
scene.add(notation3dGroup);

function buildNotation3D() {
  notation3dGroup.clear();
  if (!UI_PREFS.notation3d) return;
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      // Only show for active layer
      const z = activeZ;
      const file = String.fromCharCode(65 + x);
      const rank = (y + 1).toString();
      const label = file + rank;
      const cv = document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0,0,32,32);
      ctx.fillStyle = 'rgba(0,200,255,0.7)';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 16, 16);
      const tex = new THREE.CanvasTexture(cv);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8 });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.4, 0.4, 1);
      const half2 = (8 * 1.2) / 2;
      sprite.position.set(
        -half2 + (x + 0.5) * 1.2,
        layers[z].position.y + 0.15,
        -half2 + (y + 0.5) * 1.2
      );
      notation3dGroup.add(sprite);
    }
  }
}

// Add 3D notation toggle to UI panel
(function addNotationToggle() {
  const overlay = document.getElementById('uiSettingsOverlay');
  if (!overlay) return;
  const container = overlay.querySelector('div[style*="width:220px"]');
  if (!container) return;
  const lbl = document.createElement('label');
  lbl.id = 'uiToggle_notation3d';
  lbl.className = 'uiToggleRow';
  lbl.innerHTML = '<span>3D Square Labels</span><span class="uiToggleDot off">●</span>';
  lbl.onclick = () => {
    UI_PREFS.notation3d = !UI_PREFS.notation3d;
    notation3dGroup.visible = UI_PREFS.notation3d;
    const dot = lbl.querySelector('.uiToggleDot');
    dot.className = 'uiToggleDot ' + (UI_PREFS.notation3d ? 'on' : 'off');
    if (UI_PREFS.notation3d) buildNotation3D();
    else notation3dGroup.clear();
  };
  // Insert after trails toggle
  const traileEl = document.getElementById('uiToggle_trails');
  if (traileEl && traileEl.nextSibling) container.insertBefore(lbl, traileEl.nextSibling);
  else container.appendChild(lbl);
})();

// Rebuild when layer changes
const _zSliderForNotation = document.getElementById('zSlider').oninput;
document.getElementById('zSlider').oninput = function(e) {
  if (_zSliderForNotation) _zSliderForNotation.call(this, e);
  if (UI_PREFS.notation3d) buildNotation3D();
};

/* ── 4. ARCADE TWEAKS ── */
// a) Orb expiry — orbs disappear after 6 turns if uncollected
// b) Two new random events: GRAVITY and MIRROR
// c) Score display in arcade bar
// d) Bonus points for capturing with upgraded pieces

// Patch spawnOrb to add turnsLeft
const _origCreateOrbMesh = createOrbMesh;
// Patch the orb spawning to add expiry
const _origSpawnOrb = typeof spawnOrb !== 'undefined' ? spawnOrb : null;
// Patch the arcade turn hook
const _origArcadeAfterMove = typeof arcadeAfterMove !== 'undefined' ? arcadeAfterMove : null;

// Hook executeMove for score tracking
const _execBeforeArcadeScore = executeMove;
executeMove = function(piece, t) {
  const victim = occ(t.x, t.y, t.z);
  _execBeforeArcadeScore.call(this, piece, t);
  if (arcadeActive && victim && typeof arcadeScore !== 'undefined') {
    const col = piece.userData.color;
    const baseVal = (BOT_VALUES[victim.userData.type] || 1);
    const hasPower = piece.userData.arcadePower;
    arcadeScore[col] = (arcadeScore[col] || 0) + baseVal + (hasPower ? 2 : 0);
    updateArcadeBar();
  }
};

// Extend updateArcadeBar to show score
const _origUpdateArcadeBar = updateArcadeBar;
updateArcadeBar = function() {
  _origUpdateArcadeBar();
  if (!arcadeActive) return;
  const bar = document.getElementById('arcadeBarText');
  if (!bar) return;
  const txt = bar.textContent;
  const scoreStr = '  ·  W:' + (arcadeScore.white||0) + ' B:' + (arcadeScore.black||0);
  if (!txt.includes('W:')) bar.textContent = txt + scoreStr;
};

/* ── 6. TRAIL RENDER HOOK in animation loop ── */
const _origRunAnimations = runAnimations;
runAnimations = function() {
  _origRunAnimations();
  updateTrails();
};

/* ── 9. Reset arcadeScore on game start ── */
const _origStartLocalGame = startLocalGame;
startLocalGame = function() {
  _origStartLocalGame.call(this);
  arcadeScore.white = 0; arcadeScore.black = 0;
};


/* ================================================================
   FEATURE IMPLEMENTATIONS
   Controlled by UI_PREFS toggles in the UI/Controls overlay.
================================================================ */

/* ── 1. LAYER LABELS beside the vertical slider ── */
(function initLayerLabels() {
  const el = document.createElement('div');
  el.id = 'layerLabelsEl';
  el.style.cssText = [
    'position:fixed', 'right:1px', 'top:50%',
    'transform:translateY(-50%)',
    'display:flex', 'flex-direction:column-reverse',
    'gap:0', 'z-index:19',
    'pointer-events:none', 'justify-content:space-between',
    'height:56vh'
  ].join(';');
  for (let z = 0; z < LAYERS; z++) {
    const lbl = document.createElement('div');
    lbl.dataset.z = z;
    lbl.style.cssText = 'font-family:monospace;font-size:8px;color:#444;letter-spacing:0;line-height:1;text-align:right;';
    lbl.textContent = ''; // numbers removed per UX request — highlight colour still applied
    el.appendChild(lbl);
  }
  document.body.appendChild(el);

  // Highlight active layer label
  function refreshLabels() {
    el.querySelectorAll('div').forEach(d => {
      const z = parseInt(d.dataset.z);
      d.style.color = z === activeZ ? '#00ccff' : '#333';
      d.style.fontWeight = z === activeZ ? 'bold' : 'normal';
    });
  }
  setInterval(refreshLabels, 200);

  // Show/hide based on toggle
  function syncVisibility() {
    el.style.display = UI_PREFS.layerLabels ? 'flex' : 'none';
  }
  setInterval(syncVisibility, 500);
})();

/* ── 2. AUTO-ROTATE (FREE mode, in-game, no touch activity) ── */
let _lastTouchActivity = 0;
(function patchTouchForAutoRotate() {
  ['touchstart','touchmove','pointerdown','pointermove'].forEach(ev => {
    renderer.domElement.addEventListener(ev, () => { _lastTouchActivity = performance.now(); }, { passive: true });
  });
})();

/* ── 3. MENU IDLE SPIN ── */
// Handled inline in anim() — see patch below

/* ── 4. HOVER TOOLTIP (long-press a piece to see its name) ── */
(function initHoverTooltip() {
  const tip = document.createElement('div');
  tip.id = 'hoverTip';
  tip.style.cssText = [
    'position:fixed', 'top:52px', 'left:50%',
    'transform:translateX(-50%)',
    'background:rgba(0,0,0,0.85)', 'border:1px solid #333',
    'color:#00ccff', 'font-family:monospace', 'font-size:11px',
    'letter-spacing:2px', 'padding:3px 10px',
    'pointer-events:none', 'z-index:25',
    'display:none', 'white-space:nowrap'
  ].join(';');
  document.body.appendChild(tip);

  let _tipTimer = null;
  const NAMES = { pawn:'PAWN', rook:'ROOK', knight:'KNIGHT', bishop:'BISHOP', queen:'QUEEN', king:'KING' };

  renderer.domElement.addEventListener('touchstart', function(e) {
    if (!UI_PREFS.hoverTooltip) return;
    if (e.touches.length !== 1) return;
    const r = renderer.domElement.getBoundingClientRect();
    const mv2 = { x: ((e.touches[0].clientX - r.left) / r.width) * 2 - 1,
                  y: -((e.touches[0].clientY - r.top) / r.height) * 2 + 1 };
    const rc2 = new THREE.Raycaster();
    rc2.setFromCamera(mv2, camera);
    const hits = rc2.intersectObjects(pieces, true);
    let piece = null;
    for (const h of hits) { const root = findPieceRoot(h.object); if (root) { piece = root; break; } }
    if (!piece) return;
    clearTimeout(_tipTimer);
    _tipTimer = setTimeout(() => {
      const col = piece.userData.color === 'white' ? '#fff' : '#888';
      tip.style.color = col;
      tip.textContent = (NAMES[piece.userData.type] || piece.userData.type.toUpperCase())
        + '  L' + (piece.userData.z + 1)
        + '  ' + String.fromCharCode(65 + piece.userData.x) + (piece.userData.y + 1);
      tip.style.display = 'block';
      setTimeout(() => { tip.style.display = 'none'; }, 1800);
    }, 380);
  }, { passive: true });

  renderer.domElement.addEventListener('touchend', () => { clearTimeout(_tipTimer); }, { passive: true });
})();

/* ── Patch anim() to handle autoRotate + idleSpin ── */
(function patchAnimForFeatures() {
  // We can't replace anim() since it calls requestAnimationFrame(anim).
  // Instead hook into the per-frame pivot logic via a separate rAF loop
  // that runs BEFORE the renderer.render call.
  // Actually: safest is to patch by wrapping camTickTransition.
  const _origCamTick = camTickTransition;
  camTickTransition = function() {
    _origCamTick();

    const mainOpen = document.getElementById('mainMenu') && document.getElementById('mainMenu').style.display !== 'none';
    const modeOpen = document.getElementById('modeMenu') && document.getElementById('modeMenu').style.display !== 'none';
    const menuOpen  = mainOpen || modeOpen;

    // Idle spin on menus
    if (UI_PREFS.idleSpin && menuOpen) {
      pivot.rotation.y += 0.003;
    }

    // Auto-rotate in-game FREE mode
    if (UI_PREFS.autoRotate && !menuOpen && gameStarted &&
        typeof cameraMode !== 'undefined' && cameraMode === CAMERA_MODES.FREE) {
      const idle = performance.now() - _lastTouchActivity;
      if (idle > 4000) {  // 4s idle → start spinning
        pivot.rotation.y += 0.004;
      }
    }
  };
})();

/* ================================================================
   ── BASIC SETTINGS TAB — mirror controls to existing CFG/handlers
================================================================ */
(function wireBasicTab() {
  const bSoundOn = document.getElementById('bSoundOn');
  const bVol     = document.getElementById('bMasterVolume');
  if (bSoundOn) { bSoundOn.checked = SND.on; bSoundOn.addEventListener('change', e => { SND.on = e.target.checked; const adv = document.getElementById('soundOn'); if(adv) adv.checked = e.target.checked; }); }
  if (bVol)     { bVol.value = Math.round(SND.vol*100); bVol.addEventListener('input', e => { SND.vol = parseInt(e.target.value)/100; const adv = document.getElementById('masterVolume'); if(adv) adv.value = e.target.value; }); }
  const bHapticOn = document.getElementById('bHapticOn');
  if (bHapticOn) { bHapticOn.checked = HAP.on; bHapticOn.addEventListener('change', e => { HAP.on = e.target.checked; const adv = document.getElementById('hapticOn'); if(adv) adv.checked = e.target.checked; }); }
  document.querySelectorAll('[data-bhaptic]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bhaptic === HAP.intensity);
    btn.onclick = () => {
      HAP.intensity = btn.dataset.bhaptic;
      document.querySelectorAll('[data-bhaptic]').forEach(b => b.classList.toggle('active', b.dataset.bhaptic === HAP.intensity));
      document.querySelectorAll('[data-haptic]').forEach(b => b.classList.toggle('active', b.dataset.haptic === HAP.intensity));
      HAP.vib('select');
    };
  });
  document.querySelectorAll('[data-btheme]').forEach(btn => {
    btn.onclick = () => {
      SND.ui();
      const advChip = document.querySelector('[data-theme="' + btn.dataset.btheme + '"]');
      if (advChip) advChip.click();
      document.querySelectorAll('[data-btheme]').forEach(b => b.classList.toggle('active', b.dataset.btheme === btn.dataset.btheme));
    };
  });
  const bWhite = document.getElementById('bWhitePieceColor');
  const bBlack = document.getElementById('bBlackPieceColor');
  if (bWhite) bWhite.addEventListener('input', e => { CFG.pieces.white.color = hexToInt(e.target.value); applyPieceColors(); const adv = document.getElementById('whitePieceColor'); if(adv) adv.value = e.target.value; });
  if (bBlack) bBlack.addEventListener('input', e => { CFG.pieces.black.color = hexToInt(e.target.value); applyPieceColors(); const adv = document.getElementById('blackPieceColor'); if(adv) adv.value = e.target.value; });
  document.querySelectorAll('[data-bcam]').forEach(btn => {
    btn.onclick = () => {
      SND.ui();
      const modeMap = { free: CAMERA_MODES.FREE, tilt: CAMERA_MODES.TILT, flat: CAMERA_MODES.FLAT, slice: CAMERA_MODES.SLICE };
      if (typeof setCameraMode === 'function' && modeMap[btn.dataset.bcam] !== undefined) setCameraMode(modeMap[btn.dataset.bcam]);
      document.querySelectorAll('[data-bcam]').forEach(b => b.classList.toggle('active', b.dataset.bcam === btn.dataset.bcam));
    };
  });
  const bBgColor = document.getElementById('bBgColor');
  if (bBgColor) {
    bBgColor.addEventListener('input', e => {
      BG.color = e.target.value;
      const adv = document.getElementById('bgColor'); if(adv) adv.value = e.target.value;
      document.body.style.background = e.target.value;
    });
  }
  const bLegal  = document.getElementById('bLegalMoves');
  const bThr    = document.getElementById('bThreats');
  const bCoords = document.getElementById('bCoords');
  const bRotBtn = document.getElementById('bShowRotateBtn');
  const _applyFn = () => typeof _applyUIPrefWrapped==='function' ? _applyUIPrefWrapped : applyUIPref;
  if (bLegal)  { bLegal.checked  = UI_PREFS.legalMoves; bLegal.addEventListener('change',  e => _applyFn()('legalMoves', e.target.checked)); }
  if (bThr)    { bThr.checked    = UI_PREFS.threats;    bThr.addEventListener('change',    e => _applyFn()('threats', e.target.checked)); }
  if (bCoords) { bCoords.checked = UI_PREFS.coords;     bCoords.addEventListener('change', e => _applyFn()('coords', e.target.checked)); }
  if (bRotBtn) {
    bRotBtn.checked = true;
    bRotBtn.addEventListener('change', e => {
      const rbtn = document.getElementById('rotateBoardBtn');
      if (rbtn) rbtn.style.display = e.target.checked ? 'block' : 'none';
    });
  }
})();

/* ================================================================
   ── ADVANCED CONTROLS TAB
================================================================ */
(function wireAdvControlsTab() {
  const map = [
    ['advGhosts','ghosts'],['advTrails','trails'],
    ['advThreatArrows','threatArrows'],['advHoverTooltip','hoverTooltip'],['advLayerLabels','layerLabels'],
    ['advAutoRotate','autoRotate'],['advIdleSpin','idleSpin'],
    ['advBoardRotate','boardRotate'],['advPinchZoom','pinchZoom'],['advSwipeLayer','swipeLayer'],
    ['advOpponentLayerAnim','opponentLayerAnim'],
    ['advAutoLayerSwitch','autoLayerSwitch']
  ];
  map.forEach(function(pair) {
    var elId = pair[0], key = pair[1];
    var el = document.getElementById(elId); if (!el) return;
    el.checked = UI_PREFS[key] !== undefined ? UI_PREFS[key] : true;
    el.addEventListener('change', function(e) {
      var fn = typeof _applyUIPrefWrapped==='function' ? _applyUIPrefWrapped : applyUIPref;
      fn(key, e.target.checked);
    });
  });
})();

/* ================================================================
   ── UI STYLE SYSTEM
================================================================ */
var UI_STYLE = {
  panelBg:'#000000', panelOpacity:0.75, panelBorder:'#1a1a1a',
  fontColor:'#ffffff', fontAccent:'#00ccff', fontDim:'#555555',
  btnBg:'#0e0e0e', btnBorder:'#252525', btnActiveBorder:'#00ccff',
  fontFamily:'monospace'
};
var UI_STYLE_DEFAULTS = Object.assign({}, UI_STYLE);

function hexToRgba(hex, opacity) {
  var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return 'rgba('+r+','+g+','+b+','+opacity+')';
}
function applyUIStyle() {
  // 1. Update CSS custom properties (for elements that use var())
  var el = document.getElementById('uiStyleVars');
  if (!el) { el=document.createElement('style'); el.id='uiStyleVars'; document.head.appendChild(el); }
  el.textContent = ':root{'
    +'--ui-panel-bg:'+hexToRgba(UI_STYLE.panelBg,UI_STYLE.panelOpacity)+';'
    +'--ui-panel-border:'+UI_STYLE.panelBorder+';'
    +'--ui-font:'+UI_STYLE.fontColor+';'
    +'--ui-font-dim:'+UI_STYLE.fontDim+';'
    +'--ui-font-accent:'+UI_STYLE.fontAccent+';'
    +'--ui-btn-bg:'+UI_STYLE.btnBg+';'
    +'--ui-btn-border:'+UI_STYLE.btnBorder+';'
    +'--ui-btn-active-bdr:'+UI_STYLE.btnActiveBorder+';'
    +'--ui-font-family:'+UI_STYLE.fontFamily+';'
    +'}';

  // 2. Directly patch in-game elements with hardcoded inline styles
  // (inline style="" always wins over CSS variables, so we must override them directly)
  var panelBgVal = hexToRgba(UI_STYLE.panelBg, UI_STYLE.panelOpacity);

  // HUD text bar
  var hudEl = document.getElementById('hud');
  if (hudEl) {
    hudEl.style.color = UI_STYLE.fontColor;
    hudEl.style.background = panelBgVal;
    hudEl.style.borderColor = UI_STYLE.panelBorder;
    hudEl.style.fontFamily = UI_STYLE.fontFamily;
  }

  // In-game toolbar buttons
  ['menuBtn','moveToggle','viewToggle'].forEach(function(id) {
    var btn = document.getElementById(id); if (!btn) return;
    btn.style.background = UI_STYLE.btnBg;
    btn.style.color = UI_STYLE.fontColor;
    btn.style.borderColor = UI_STYLE.btnBorder;
    btn.style.fontFamily = UI_STYLE.fontFamily;
  });

  // Rotate board button
  var rbtn = document.getElementById('rotateBoardBtn');
  if (rbtn) {
    rbtn.style.background = UI_STYLE.btnBg;
    rbtn.style.color = UI_STYLE.fontDim;
    rbtn.style.borderColor = UI_STYLE.btnBorder;
    rbtn.style.fontFamily = UI_STYLE.fontFamily;
  }

  // Move panel
  var mp = document.getElementById('movePanel');
  if (mp) {
    mp.style.background = panelBgVal;
    mp.style.color = UI_STYLE.fontColor;
    mp.style.borderColor = UI_STYLE.panelBorder;
    mp.style.fontFamily = UI_STYLE.fontFamily;
  }

  // Review controls bar
  var rc = document.getElementById('reviewControls');
  if (rc) {
    rc.style.background = panelBgVal;
    rc.style.borderColor = UI_STYLE.panelBorder;
  }

  // Move number mini-bar
  var mnb = document.getElementById('moveNumBar');
  if (mnb) {
    mnb.style.background = panelBgVal;
    mnb.style.borderColor = UI_STYLE.panelBorder;
  }

  // Review counter text
  var rctr = document.getElementById('reviewCounter');
  if (rctr) rctr.style.color = UI_STYLE.fontColor;

  // Arcade bar
  var ab = document.getElementById('arcadeBar');
  if (ab) {
    ab.style.background = panelBgVal;
    ab.style.borderColor = UI_STYLE.panelBorder;
    ab.style.fontFamily = UI_STYLE.fontFamily;
  }

  // Layer flash text
  var lf = document.getElementById('layerFlash');
  if (lf) lf.style.fontFamily = UI_STYLE.fontFamily;

  // Chess clock elements
  ['clockW','clockB'].forEach(function(id) {
    var cel = document.getElementById(id); if (!cel) return;
    cel.style.background = UI_STYLE.btnBg;
    cel.style.fontFamily = UI_STYLE.fontFamily;
  });
}
function saveUIStyle(){ try{localStorage.setItem('cc_ui_style',JSON.stringify(UI_STYLE));}catch(e){} }
function loadUIStyle(){ try{var s=localStorage.getItem('cc_ui_style');if(s)Object.assign(UI_STYLE,JSON.parse(s));}catch(e){} }
loadUIStyle(); applyUIStyle();

function syncUIStyleControls() {
  function set(id,v){ var el=document.getElementById(id); if(el) el.value=v; }
  set('uiPanelBg',UI_STYLE.panelBg); set('uiPanelOpacity',Math.round(UI_STYLE.panelOpacity*100));
  set('uiPanelBorder',UI_STYLE.panelBorder); set('uiFontColor',UI_STYLE.fontColor);
  set('uiFontAccent',UI_STYLE.fontAccent); set('uiFontDim',UI_STYLE.fontDim);
  set('uiBtnBg',UI_STYLE.btnBg); set('uiBtnBorder',UI_STYLE.btnBorder);
  set('uiBtnActiveBorder',UI_STYLE.btnActiveBorder);
  document.querySelectorAll('[data-uifont]').forEach(function(b){ b.classList.toggle('active',b.dataset.uifont===UI_STYLE.fontFamily); });
}
(function wireUIStyle() {
  function wire(id,key,xfm){ var el=document.getElementById(id); if(!el)return; el.addEventListener('input',function(e){ UI_STYLE[key]=xfm?xfm(e.target.value):e.target.value; applyUIStyle(); }); }
  wire('uiPanelBg','panelBg'); wire('uiPanelOpacity','panelOpacity',function(v){return parseInt(v)/100;});
  wire('uiPanelBorder','panelBorder'); wire('uiFontColor','fontColor');
  wire('uiFontAccent','fontAccent'); wire('uiFontDim','fontDim');
  wire('uiBtnBg','btnBg'); wire('uiBtnBorder','btnBorder'); wire('uiBtnActiveBorder','btnActiveBorder');
  document.querySelectorAll('[data-uifont]').forEach(function(btn){
    btn.onclick=function(){ UI_STYLE.fontFamily=btn.dataset.uifont; document.querySelectorAll('[data-uifont]').forEach(function(b){ b.classList.toggle('active',b.dataset.uifont===btn.dataset.uifont); }); applyUIStyle(); };
  });
  var r=document.getElementById('uiStyleResetBtn');
  if(r) r.onclick=function(){ Object.assign(UI_STYLE,UI_STYLE_DEFAULTS); applyUIStyle(); syncUIStyleControls(); };
})();

// Extend syncAllSettingsUI to also sync UI Style controls
var _origSyncAllSettingsUI_v2 = syncAllSettingsUI;
syncAllSettingsUI = function(){ _origSyncAllSettingsUI_v2(); syncUIStyleControls(); };

/* ================================================================
   ── ROTATE BOARD BUTTON
================================================================ */
(function setupRotateBtn() {
  var btn = document.getElementById('rotateBoardBtn');
  if (!btn) return;

  btn.onclick = function() {
    SND.ui(); HAP.vib('ui');
    if (typeof pivot === 'undefined') return;
    var startY = pivot.rotation.y, start = performance.now(), dur = 350;
    (function rf() {
      var t = Math.min((performance.now()-start)/dur, 1);
      pivot.rotation.y = startY + (1-Math.pow(1-t,3)) * Math.PI;
      if (t<1) requestAnimationFrame(rf);
      else if (typeof coords==='function') coords();
    })();
  };

  // Visibility managed directly in startLocalGame (show) and exit handlers (hide) — no wrapping needed here
})();

/* ================================================================
   ── LAYOUT SYSTEM
================================================================ */
var LAYOUT_DEFAULT_V2 = {
  version:2,
  elements:{
    hud:{visible:true}, movePanel:{visible:true}, reviewControls:{visible:true},
    moveNumBar:{visible:true}, menuBtn:{visible:true}, moveToggle:{visible:true},
    viewToggle:{visible:true}, rotateBoardBtn:{visible:true},
    arcadeBar:{visible:true}, accountBadge:{visible:true}
  }
};
var LAYOUT_V2 = {};
try{ LAYOUT_V2=JSON.parse(localStorage.getItem('cc_layout_v2')||'{}'); }catch(e){}
if(!LAYOUT_V2.version) LAYOUT_V2=JSON.parse(JSON.stringify(LAYOUT_DEFAULT_V2));

function saveLayoutV2(){ try{localStorage.setItem('cc_layout_v2',JSON.stringify(LAYOUT_V2));}catch(e){} }

function applyLayoutElementV2(id, cfg) {
  var el=document.getElementById(id); if(!el) return;
  el.style.visibility = cfg.visible ? '' : 'hidden';
  if(cfg._customX!==undefined){ el.style.left=cfg._customX; el.style.right=''; el.style.top=cfg._customY; el.style.bottom=''; el.style.transform=''; }
}
function applyAllLayoutV2(){ Object.keys(LAYOUT_V2.elements).forEach(function(id){ applyLayoutElementV2(id, LAYOUT_V2.elements[id]); }); }

(function wireLayoutSettingsV2() {
  function wire(cbId,elId){ var cb=document.getElementById(cbId); if(!cb)return; cb.addEventListener('change',function(e){ if(!LAYOUT_V2.elements[elId])LAYOUT_V2.elements[elId]={visible:true}; LAYOUT_V2.elements[elId].visible=e.target.checked; applyLayoutElementV2(elId,LAYOUT_V2.elements[elId]); }); }
  wire('layoutShowHud','hud'); wire('layoutShowMovePanel','movePanel');
  wire('layoutShowBadge','accountBadge'); wire('layoutShowRotateBtn','rotateBoardBtn');
  var r=document.getElementById('layoutResetBtn');
  if(r) r.onclick=function(){ LAYOUT_V2=JSON.parse(JSON.stringify(LAYOUT_DEFAULT_V2)); saveLayoutV2(); applyAllLayoutV2(); };
})();

(function setupLayoutEditorV2() {
  var overlay=document.getElementById('layoutEditorOverlay');
  var openBtn=document.getElementById('openLayoutEditorBtn');
  var ltDone =document.getElementById('ltDone');
  var ltReset=document.getElementById('ltRestore');
  if(!overlay||!openBtn) return;

  var EDITABLE=[
    {id:'hud',label:'HUD'},{id:'movePanel',label:'Move List'},
    {id:'menuBtn',label:'Menu Btn'},{id:'moveToggle',label:'Moves Btn'},
    {id:'viewToggle',label:'View Btn'},{id:'rotateBoardBtn',label:'Rotate Btn'},
    {id:'arcadeBar',label:'Arcade Bar'},{id:'accountBadge',label:'Badge'},
    {id:'reviewControls',label:'Review Bar'},{id:'moveNumBar',label:'Move Bar'},
  ];
  var handles=[];

  function buildHandles() {
    handles.forEach(function(h){h.remove();}); handles=[];
    EDITABLE.forEach(function(item) {
      var target=document.getElementById(item.id); if(!target) return;
      var rect=target.getBoundingClientRect();
      if(rect.width===0&&rect.height===0) return;
      if(!LAYOUT_V2.elements[item.id]) LAYOUT_V2.elements[item.id]={visible:true};
      var cfg=LAYOUT_V2.elements[item.id];

      var h=document.createElement('div'); h.className='lh';
      h.style.left=rect.left+'px'; h.style.top=rect.top+'px';
      h.style.width=Math.max(rect.width,80)+'px'; h.style.height=Math.max(rect.height,28)+'px';

      var bar=document.createElement('div'); bar.className='lh-bar';
      var lbl=document.createElement('span'); lbl.className='lh-label'; lbl.textContent=item.label;
      var eye=document.createElement('button'); eye.className='lh-eye'+(cfg.visible?'':' hidden-el');
      eye.textContent=cfg.visible?'👁':'⊘'; eye.type='button';
      eye.onclick=function(e){ e.stopPropagation(); cfg.visible=!cfg.visible; eye.textContent=cfg.visible?'👁':'⊘'; eye.className='lh-eye'+(cfg.visible?'':' hidden-el'); applyLayoutElementV2(item.id,cfg); };
      bar.appendChild(lbl); bar.appendChild(eye); h.appendChild(bar);
      overlay.insertBefore(h, document.getElementById('layoutToolbar'));

      var sx=0,sy=0,elx=rect.left,ely=rect.top;
      h.addEventListener('pointerdown',function(e){ if(e.target===eye)return; sx=e.clientX;sy=e.clientY;elx=parseFloat(h.style.left);ely=parseFloat(h.style.top); h.setPointerCapture(e.pointerId); e.preventDefault(); });
      h.addEventListener('pointermove',function(e){ if(!h.hasPointerCapture(e.pointerId))return; var nx=elx+(e.clientX-sx),ny=ely+(e.clientY-sy); h.style.left=nx+'px'; h.style.top=ny+'px'; cfg._customX=nx+'px'; cfg._customY=ny+'px'; applyLayoutElementV2(item.id,cfg); });
      handles.push(h);
    });
  }

  function openEditor(){
    overlay.classList.add('active');
    var so=document.getElementById('settingsOverlay'); if(so) so.style.display='none';
    buildHandles();
  }
  function closeEditor(save){
    if(save) saveLayoutV2();
    overlay.classList.remove('active');
    handles.forEach(function(h){h.remove();}); handles=[];
    var so=document.getElementById('settingsOverlay'); if(so) so.style.display='flex';
  }

  openBtn.onclick=function(){ SND.ui(); openEditor(); };
  if(ltDone)  ltDone.onclick=function(){ closeEditor(true); };
  if(ltReset) ltReset.onclick=function(){ LAYOUT_V2=JSON.parse(JSON.stringify(LAYOUT_DEFAULT_V2)); handles.forEach(function(h){h.remove();}); handles=[]; buildHandles(); };
})();

setTimeout(applyAllLayoutV2, 600);

/* ================================================================
   ── HELPER: resolve current preview page across tier system
================================================================ */
function _currentPreviewPage() {
  var topTab = document.querySelector('.stTab.active');
  if (topTab && topTab.dataset.page === 'pageAdvanced') {
    var adv = document.querySelector('.advTab.active');
    return adv ? adv.dataset.adv : 'pagePieces';
  }
  return 'pagePieces';
}


