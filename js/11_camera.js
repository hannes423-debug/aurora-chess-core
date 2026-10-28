/* ======================================================
   CAMERA SYSTEM
   Modes: FREE | TILT | FLAT | SLICE
   All logic is self-contained; existing code is only
   extended via camOnLayerChange() and camTickTransition()
   which are called from the patched zSlider, touchmove,
   and anim() render loop.
====================================================== */

const CAMERA_MODES = { FREE:'free', TILT:'tilt', FLAT:'flat', SLICE:'slice' };
// Default: TILT on landscape, FREE on portrait
let cameraMode = (window.innerWidth > window.innerHeight)
  ? CAMERA_MODES.TILT
  : CAMERA_MODES.FREE;

const CAM_MODE_ORDER = [CAMERA_MODES.FREE, CAMERA_MODES.TILT, CAMERA_MODES.FLAT, CAMERA_MODES.SLICE];
const CAM_MODE_LABELS = { free:'FREE', tilt:'TILT', flat:'FLAT', slice:'SLICE' };

/* ── Camera transition state ── */
const _camTrans = {
  active:    false,
  startPos:  new THREE.Vector3(),
  targetPos: new THREE.Vector3(),
  startLook: new THREE.Vector3(),
  targetLook:new THREE.Vector3(),
  startTime: 0,
  duration:  300
};
// Current camera look-at target (updated each frame for smooth cam.lookAt)
const _camLookAt = new THREE.Vector3(0,0,0);

/* ── Compute target camera pos+lookAt for a given mode + activeZ ── */
function camGetTarget(mode, z) {
  // Board is 9.6 units wide (8 × 1.2). With FOV=60 we need ~11 units distance
  // to see the full width. Camera height is always fixed at the stack center (Y=0)
  // so switching layers never moves the camera or board vertically.
  const side = (playerColor === 'black') ? -1 : 1;
  switch(mode){
    case CAMERA_MODES.FREE:
      return { pos: new THREE.Vector3(0, 18, 30 * side), look: new THREE.Vector3(0, 0, 0) };
    case CAMERA_MODES.TILT:
      return { pos: new THREE.Vector3(0, 11, 11 * side), look: new THREE.Vector3(0, 0, 0) };
    case CAMERA_MODES.FLAT: {
      // Auto-fit: compute camera height so the board + coord labels always fill the screen
      // Board + coord labels span (half + 1.4) units from centre in both X and Z
      const _flatAspect = camera.aspect || (vw() / vh());
      const _flatFov = THREE.MathUtils.degToRad(camera.fov || 60);
      const _boardHalf = half + 1.4; // half=4.8, labels add ~1.4 → 6.2 units
      // Constraining dimension: portrait → width-limited, landscape → height-limited
      const _fitDist = (_boardHalf / (Math.tan(_flatFov / 2) * Math.min(1, _flatAspect))) * 1.08;
      const _layerY = (typeof layers !== 'undefined' && layers[z]) ? layers[z].position.y : 0;
      return { pos: new THREE.Vector3(0, _layerY + _fitDist, 0.001 * side), look: new THREE.Vector3(0, _layerY, 0) };
    }
    case CAMERA_MODES.SLICE:
      return { pos: new THREE.Vector3(0, 4, 15 * side), look: new THREE.Vector3(0, -1, 0) };
  }
  return { pos: new THREE.Vector3(0, 18, 30 * side), look: new THREE.Vector3(0,0,0) };
}

/* ── Kick off a 300ms smooth camera transition ── */
function animateCamera(targetPos, targetLook) {
  _camTrans.active    = true;
  _camTrans.startPos.copy(camera.position);
  _camTrans.targetPos.copy(targetPos);
  _camTrans.startLook.copy(_camLookAt);
  _camTrans.targetLook.copy(targetLook);
  _camTrans.startTime = performance.now();
}

/* ── Called every frame from anim() ── */
function camTickTransition() {
  if (!_camTrans.active) return;
  const elapsed = performance.now() - _camTrans.startTime;
  const raw   = Math.min(elapsed / _camTrans.duration, 1);
  // Ease-out cubic
  const t = 1 - Math.pow(1 - raw, 3);
  camera.position.lerpVectors(_camTrans.startPos, _camTrans.targetPos, t);
  _camLookAt.lerpVectors(_camTrans.startLook, _camTrans.targetLook, t);
  camera.lookAt(_camLookAt);
  camera.updateProjectionMatrix();
  if (raw >= 1) _camTrans.active = false;
}

/* ── Apply a mode: lock/unlock pivot rotation, transition camera ── */
function camApplyMode(mode, instant) {
  cameraMode = mode;
  const { pos, look } = camGetTarget(mode, activeZ);

  // In FREE mode unlock pivot drag; in others lock it (piece interaction only)
  // The touchmove handler already gates on cameraMode === FREE
  if (mode === CAMERA_MODES.FREE) {
    pivot.rotation.x = 0.1;
    pivot.rotation.y = (playerColor === 'black') ? 3 + Math.PI : 3;
} else {
    // Keep POV orientation — both colours use Math.PI, cameras sit on opposite sides
    pivot.rotation.x = 0;
    pivot.rotation.y = Math.PI;
  }
    // Flatten pivot for clean top/tilt views

  if (instant) {
    camera.position.copy(pos);
    _camLookAt.copy(look);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    _camTrans.active = false;
  } else {
    animateCamera(pos, look);
  }

  update();   // refresh layer visibility / opacities for new mode
  coords();   // refresh coordinate labels

  // Update VIEW button label
  const btn = document.getElementById('viewToggle');
  if (btn) btn.textContent = CAM_MODE_LABELS[mode] || 'VIEW';
}

/* ── Called whenever activeZ changes ── */
function camOnLayerChange() {
  // Only FLAT mode needs to reposition the camera on layer change —
  // it auto-fits to the active layer. TILT/SLICE look-at is always (0,0,0)
  // regardless of activeZ, so moving the camera there just resets zoom.
  if (cameraMode === CAMERA_MODES.FLAT) {
    const { pos, look } = camGetTarget(cameraMode, activeZ);
    camera.position.copy(pos);
    _camLookAt.copy(look);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    _camTrans.active = false;
  }
  update();
}

/* ── VIEW button: cycle modes ── */
document.getElementById('viewToggle').onclick = () => {
  SND.ui();
  const idx  = CAM_MODE_ORDER.indexOf(cameraMode);
  const next = CAM_MODE_ORDER[(idx + 1) % CAM_MODE_ORDER.length];
  camApplyMode(next, false);
};

/* ── Orientation change: switch default mode ── */
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    const landscape = window.innerWidth > window.innerHeight;
    camApplyMode(landscape ? CAMERA_MODES.TILT : CAMERA_MODES.FREE, false);
  }, 250);
});

/* ── Apply initial mode instantly on load ── */
camApplyMode(cameraMode, true);

// Tracks which layer the player last moved a piece TO
let playerLastLayer = 0;

// Highlight state — drives per-frame opacity overrides for one layer
let _layerHL = {
  active:  false,
  z:       -1,
  opacity: 0.0,
  phase:   'in',     // 'in' | 'hold' | 'out'
  t:       0,
  IN_MS:   300,
  HOLD_MS: 1400,
  OUT_MS:  900,
};

// Called each frame from anim()
function tickLayerHighlight(dt) {
  if (!_layerHL.active) return;
  _layerHL.t += dt;
  let raw = 0;
  if (_layerHL.phase === 'in') {
    raw = Math.min(_layerHL.t / _layerHL.IN_MS, 1);
    if (raw >= 1) { _layerHL.phase = 'hold'; _layerHL.t = 0; }
  } else if (_layerHL.phase === 'hold') {
    raw = 1;
    if (_layerHL.t >= _layerHL.HOLD_MS) { _layerHL.phase = 'out'; _layerHL.t = 0; }
  } else {
    raw = 1 - Math.min(_layerHL.t / _layerHL.OUT_MS, 1);
    if (raw <= 0) {
      _layerHL.active = false; raw = 0;
      const gl = gridLines[_layerHL.z];
      if (gl) gl.material.color.setHex(CFG.grid.activeColor);
      update();
    }
  }
  _layerHL.opacity = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
  const z = _layerHL.z;
  const gl = gridLines[z];
  if (gl && !cosmicGlassActive) {
    const base = (z === activeZ) ? CFG.grid.activeOpacity : CFG.grid.dimOpacity;
    const peak = CFG.grid.activeOpacity + 0.25;
    gl.material.opacity = base + (peak - base) * _layerHL.opacity;
    gl.material.color.setHex(0x00ccff);
  }
  pieces.forEach(p => {
    if (p.userData.z !== z) return;
    const baseOp = (z === activeZ) ? 1.0 : 0.25;
    setPieceMat(p, { transparent: true, opacity: baseOp + (1.0 - baseOp) * _layerHL.opacity });
  });
}

function highlightLayerThenReturn(hlZ, returnZ) {
  // Legacy: kept for compatibility. New code uses animOpponentLayerSequence.
  _layerHL.active = true; _layerHL.z = hlZ; _layerHL.opacity = 0;
  _layerHL.phase = 'in'; _layerHL.t = 0;
  setTimeout(() => {
    if (activeZ !== returnZ) {
      activeZ = returnZ;
      const slider = document.getElementById('zSlider');
      if (slider) { slider.value = returnZ; slider.dispatchEvent(new Event('input')); }
      camOnLayerChange();
    }
  }, _layerHL.IN_MS + _layerHL.HOLD_MS + 100);
}

function jumpToLayer(z) {
  // Instant layer change — used by slider/swipe
  if (z === activeZ) return;
  activeZ = z;
  const slider = document.getElementById('zSlider');
  if (slider) { slider.value = z; slider.dispatchEvent(new Event('input')); }
}

/* ── Smooth layer crawl: steps through each layer between from and to.
   msPerStep: time per layer step (ms). onComplete: called when done. ── */
function animLayerCrawl(fromZ, toZ, msPerStep, onComplete) {
  if (fromZ === toZ) { if (onComplete) onComplete(); return; }
  const dir = toZ > fromZ ? 1 : -1;
  let current = fromZ;

  function step() {
    current += dir;
    // Update activeZ and slider silently (no sound/haptic spam)
    activeZ = current;
    const slider = document.getElementById('zSlider');
    if (slider) slider.value = current;
    update();
    coords();
    SND.layer(current); // soft layer sound each step
    if (current === toZ) {
      if (onComplete) onComplete();
    } else {
      setTimeout(step, msPerStep);
    }
  }
  setTimeout(step, msPerStep);
}

/* ── Full opponent move layer sequence:
     1. Crawl from player's current layer → opponent's dest layer (180ms/step)
     2. Highlight dest layer glow (pulse) + pause so player can see the move
     3. Crawl back to player's last layer (180ms/step)
── */
function animOpponentLayerSequence(startZ, botDestZ, returnZ) {
  const MS_PER_STEP  = 180;  // ms per layer step — smooth but easy to follow
  const PAUSE_AT_DEST = 1100; // ms to linger at opponent's layer

  // Step 1: crawl to bot dest
  animLayerCrawl(startZ, botDestZ, MS_PER_STEP, function() {
    // Step 2: arrived — activate layer highlight glow
    _layerHL.active = true;
    _layerHL.z      = botDestZ;
    _layerHL.opacity = 0;
    _layerHL.phase  = 'in';
    _layerHL.t      = 0;

    // Step 3: after pause, crawl back
    setTimeout(function() {
      animLayerCrawl(botDestZ, returnZ, MS_PER_STEP, function() {
        // Arrived back — camera snaps to player layer
        camOnLayerChange();
      });
    }, PAUSE_AT_DEST);
  });
}

let _animLastT = performance.now();
let _animId    = null;
// FPS counter — enable with: window.showFPS = true
let _fpsFrames = 0, _fpsLastT = performance.now(), _fpsEl = null;
function _tickFPS(now) {
  _fpsFrames++;
  if (now - _fpsLastT >= 1000) {
    var fps = Math.round(_fpsFrames * 1000 / (now - _fpsLastT));
    _fpsFrames = 0; _fpsLastT = now;
    if (window.showFPS) {
      if (!_fpsEl) {
        _fpsEl = document.createElement('div');
        _fpsEl.style.cssText = 'position:fixed;bottom:4px;left:4px;z-index:9999;font-family:monospace;font-size:10px;color:#00e5ff;background:rgba(0,0,0,0.65);padding:2px 6px;border-radius:2px;pointer-events:none;letter-spacing:1px;';
        document.body.appendChild(_fpsEl);
      }
      _fpsEl.style.display = 'block';
      _fpsEl.textContent = fps + ' fps';
    } else if (_fpsEl) {
      _fpsEl.style.display = 'none';
    }
  }
}
function anim(){
  _animId = requestAnimationFrame(anim);
  const now = performance.now();
  _tickFPS(now);
  const dt  = Math.min(now - _animLastT, 100); // cap at 100ms (tab hidden etc)
  _animLastT = now;
  _pieceMaterialClock += dt * 0.001; // ms → s
  // Animate Cosmic piece preset emissive shimmer (skip if no cosmic pieces)
  if (_hasCosmicPieces) (function tickCosmic(){
    const t = _pieceMaterialClock;
    pieces.forEach(p => {
      p.traverse(obj => {
        if (!obj.isMesh || !obj.material || !obj.material.userData || !obj.material.userData.isCosmic) return;
        const baseHue = obj.material.userData.cosmicBaseHue || 0.77;
        const n = Math.sin(t * 1.3 + obj.uuid.charCodeAt(0) * 0.01) * 0.5 + 0.5;
        const n2 = Math.sin(t * 0.7 + obj.uuid.charCodeAt(2) * 0.01) * 0.5 + 0.5;
        obj.material.emissive.setHSL((baseHue + t * 0.04 + n2 * 0.1) % 1, 0.9, 0.35);
        obj.material.emissiveIntensity = 0.8 + n * 1.4;
      });
    });
  })();
  runAnimations();
  camTickTransition();
  tickLayerHighlight(dt);
  pulseT+=0.05;
  // ── Cosmic Glass: board float animation (no shaders) ──
  if (cosmicGlassActive && _cgSlabs.length) {
    _cgTime += 0.016;
    const _cgFloat  = Math.sin(_cgTime * 0.4) * 0.05;
    const _cgSlabHH = 0.35 / 2; // half slab height
    _cgSlabs.forEach(function(s) {
      s.slab.position.y = -_cgSlabHH + _cgFloat;
      // Edge and grid both float at slab top surface + tiny z-fight offset, so they stay co-planar
      s.edge.position.y = _cgFloat + 0.01;
      s.grid.position.y = _cgFloat + 0.01;
    });
  }
  pulsePlates=pulsePlates.filter(p=>p.parent);
  pulsePlates.forEach(p=>{const base=p.userData.baseOpacity;const onActive=Math.abs(p.position.y-(layers[activeZ].position.y+0.01))<0.02;p.material.opacity=onActive?base+0.20+Math.sin(pulseT)*0.15:base;});
  // Force-sync highlight visibility every frame — prevents any stale .visible=true from slipping through
  movePlates.forEach(function(p){p.visible=CFG.hl.legal.on&&isLayerShowing(p.userData.z);});
  lastMoveSquares.forEach(function(p){p.visible=CFG.hl.lastMove.on&&isLayerShowing(p.userData.z);});
  if(typeof crossLayerThreatMeshes!=='undefined')crossLayerThreatMeshes.forEach(function(p){p.visible=isLayerShowing(p.userData.z);});
  // Animate piece glow — skip if no glow pieces to save CPU
  if (_hasGlowPieces) (function tickGlow(){
    const gt = performance.now() * 0.0008;
    var _glowOn = (typeof UI_PREFS === 'undefined' || UI_PREFS.glow !== false);
    pieces.forEach(function(p) {
      p.traverse(function(obj) {
        if (!obj.userData.isGlow) return;
        if (!_glowOn) { obj.material.opacity = 0; return; }
        const onLayer = p.userData.z === activeZ;
        // These run every frame, so a presentation layer cannot simply set the
        // sprite opacity once — it gets overwritten before the next draw. The
        // cozy theme (js/25_cozy_scene.js) dials the halo down through this
        // hook; with no override the neon defaults apply exactly as before.
        const _g = (typeof CZ_GLOW !== 'undefined' && CZ_GLOW)
                 ? CZ_GLOW : { on: 0.20, off: 0.06, pulse: 0.07 };
        const base = onLayer ? _g.on : _g.off;
        const pulse = onLayer ? Math.sin(gt * 1.4 + p.userData.x * 0.9) * _g.pulse : 0;
        obj.material.opacity = base + pulse;
      });
    });
  })();
  // ── Animate arcade orbs: float/bob, tesseract 4D rotation, laser cross spin
  if (typeof activeOrbs !== 'undefined' && activeOrbs.length) {
    var _ot = performance.now() * 0.001;
    var _orbAngle = _ot * 0.65;
    activeOrbs.forEach(function(orb) {
      if (!orb.mesh || !orb.mesh.parent) return;
      var baseY = layers[orb.z].position.y + (orb.type === 'power' ? 0.5 : 0.45);
      orb.mesh.position.y = baseY + Math.sin(_ot * 1.8 + orb.t) * 0.07;
      if (orb.type === 'gravity_tesseract' && orb._verts4d) {
        var _tpts = _tesseractProject(orb._verts4d, orb._edges4d, _orbAngle + orb.t);
        var _ln0 = orb.mesh.children[0], _ln1 = orb.mesh.children[1];
        if (_ln0 && _ln0.geometry) { _ln0.geometry.attributes.position.set(_tpts); _ln0.geometry.attributes.position.needsUpdate = true; }
        if (_ln1 && _ln1.geometry) { _ln1.geometry.attributes.position.set(_tpts); _ln1.geometry.attributes.position.needsUpdate = true; }
      } else if (orb.type === 'laser_instant') {
        orb.mesh.rotation.y = _ot * 2.2 + orb.t;
      }
    });
  }
  // ── Pulse laser warning squares
  if (typeof laserWarning !== 'undefined' && laserWarning && laserWarning.warningMeshes) {
    var _lpt = performance.now() * 0.006;
    laserWarning.warningMeshes.forEach(function(group) {
      if (group._warningPlane) group._warningPlane.material.opacity = 0.25 + Math.abs(Math.sin(_lpt)) * 0.5;
    });
  }
  // Hide board when no game is active (main menu / mode selection state)
  pivot.visible = (renderer.domElement.style.pointerEvents !== 'none');
  renderer.render(scene,camera);
}

anim(); update();
syncMsgUI();

/* ======================================================
   ── iOS SAFARI — WebGL context recovery
====================================================== */
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  cancelAnimationFrame(_animId); _animId = null;  // stop loop cleanly
  cancelAnimationFrame(BG.aid); BG.aid = null;
}, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  if (_animId === null) anim();     // restart only once
  if (BG.type) BG.apply(BG.type);
}, false);

// ── Xbox / Edge: page hidden (Guide button) then visible again can blank the canvas.
//    Force a render on refocus so the frame is not left black.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (_animId === null) anim();
    else renderer.render(scene, camera);
  }
});
window.addEventListener('focus', () => {
  if (_animId === null) anim();
  else renderer.render(scene, camera);
});

/* ======================================================
   ── LANDSCAPE MODE — orientation handler
====================================================== */
function applyOrientationLayout() {
  const landscape = window.innerWidth > window.innerHeight && window.innerHeight < 520;
  document.body.classList.toggle('landscape-mode', landscape);
}
window.addEventListener('orientationchange', () => { setTimeout(applyOrientationLayout, 200); });
window.addEventListener('resize', applyOrientationLayout);
applyOrientationLayout();

