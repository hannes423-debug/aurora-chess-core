/* ==========================================================================
   AURORA CHESS CORE — minimal presentation layer
   --------------------------------------------------------------------------
   Loads after every game module. It changes how the game is PRESENTED, never
   what the game IS: the 8×8×4 board, the rules engine, the bot, local and
   online play, puzzles and replays are all the original modules, untouched.

   Owns five things:
     1. the page background — one plain, configurable colour (or transparency)
     2. a compact start screen inside the existing #mainMenu
     3. a small corner dock (camera · flip · fullscreen · background · hide UI)
     4. idle dimming of on-screen controls, for display on a large screen
     5. camera framing that keeps all four layers in view at any aspect ratio

   Same rule as js/24_cozy_ui.js: existing elements are MOVED, never
   recreated, so every id, inline handler and gamepad .click() keeps working.
   Input stays in the original modules; this file only adds a few shortcuts
   (B / H / P) that call the same functions the buttons do.
   ========================================================================== */
(function () {
  'use strict';

  // An exported standalone replay inlines every js/ module but no stylesheet
  // (js/23_replay_export.js); without css/core.css this layer has nothing to
  // add there, so the replay viewer keeps its own presentation.
  if (window.FLAG_RAID_REPLAY || window.AURORA_REPLAY || window.CTFReplayStandalone) return;

  var $ = function (id) { return document.getElementById(id); };

  function readPref(key, dflt) {
    try { var v = localStorage.getItem(key); return v === null ? dflt : v; }
    catch (e) { return dflt; }
  }
  function writePref(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }
  function urlParam(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }

  document.body.classList.add('core');

  // First-run onboarding (welcome wizard) is skipped — it is a wall of text in
  // front of the board. Help and the tutorial stay reachable from the menu.
  writePref('hasCompletedWelcome', '1');

  // Ambient music defaults to OFF here (an explicit user choice still wins).
  if (readPref('ac_music_on', null) === null && window.AuroraMusic) {
    window.AuroraMusic.on = false;
  }

  /* ======================================================================
     1. BACKGROUND
     ?bg=midnight|black|gradient|transparent|<#hex>, or B to cycle.
     'transparent' only clears the page: whether anything shows through is up
     to the host (a transparent app window, a compositor, a capture source).
     ====================================================================== */
  var BACKGROUNDS = {
    midnight:    '#14122b',
    black:       '#000000',
    gradient:    'radial-gradient(ellipse at 50% 45%, #262150 0%, #13112a 55%, #07060f 100%)',
    transparent: 'transparent'
  };
  var BG_ORDER = ['midnight', 'black', 'gradient', 'transparent'];
  var K_BG = 'core_bg';
  var coreBg = 'midnight';

  function isHex(v) { return /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v || ''); }

  function applyBackground(name) {
    var css;
    if (BACKGROUNDS[name]) css = BACKGROUNDS[name];
    else if (isHex(name)) { name = name.charAt(0) === '#' ? name : '#' + name; css = name; }
    else { name = 'midnight'; css = BACKGROUNDS.midnight; }
    coreBg = name;
    document.documentElement.style.setProperty('--core-bg', css);
    document.body.classList.toggle('core-bg-transparent', name === 'transparent');
    var btn = $('coreBgBtn');
    if (btn) btn.title = 'Background: ' + name + ' (B)';
    writePref(K_BG, name);
  }
  function cycleBackground() {
    var i = BG_ORDER.indexOf(coreBg);
    applyBackground(BG_ORDER[(i + 1) % BG_ORDER.length]);
  }
  window.coreSetBackground = applyBackground;

  // The original background system (grid / stars / nebula / photo) animated
  // canvases behind and over the board. Pin it to its static 'color' mode so
  // none of those loops run; the colour itself comes from --core-bg.
  if (typeof BG !== 'undefined' && BG.apply) {
    var _bgApply = BG.apply;
    BG.apply = function () { _bgApply.call(BG, 'color'); };
    BG.apply('color');
  }

  applyBackground(urlParam('bg') || readPref(K_BG, 'midnight'));

  /* ======================================================================
     2. START SCREEN
     The existing #mainMenu stays the menu every other module returns to
     (exit, back-to-menu, help close …); its decoration is hidden and a
     compact start block is added. "More" reveals the original menu.
     ====================================================================== */
  var coreDiff = readPref('core_diff', 'medium');
  var coreColor = readPref('core_color', 'white');

  function chipRow(label, attr, options, current, onPick) {
    var row = document.createElement('div');
    row.className = 'core-row';
    var lab = document.createElement('span');
    lab.className = 'core-row-label';
    lab.textContent = label;
    row.appendChild(lab);
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'core-chip' + (o[0] === current ? ' on' : '');
      b.dataset[attr] = o[0];
      b.textContent = o[1];
      b.addEventListener('click', function () {
        if (typeof SND !== 'undefined') SND.ui();
        row.querySelectorAll('.core-chip').forEach(function (c) { c.classList.toggle('on', c === b); });
        onPick(o[0]);
      });
      row.appendChild(b);
    });
    return row;
  }

  /* Starts a standard game through the original PLAY → configure flow, so the
     exact same lifecycle runs (time control off, hint/undo per their toggles,
     bot first move when the bot is White). */
  function startGame(players) {
    if (typeof SND !== 'undefined') SND.confirm();
    $('mainMenu').style.display = 'none';
    window._playMode = 'standard';
    window._playPlayers = players;
    var pick = function (sel) { var el = document.querySelector(sel); if (el) el.click(); };
    pick('[data-ps3diff="' + coreDiff + '"]');
    pick('[data-ps3color="' + coreColor + '"]');
    pick('[data-time="0"]');
    $('ps3Play').click();
  }
  window.coreStartGame = startGame;

  function buildStart() {
    var mm = $('mainMenu');
    if (!mm) return;
    // Original children: h1 title · subtitle · button column
    var kids = Array.prototype.slice.call(mm.children);
    if (kids[1]) kids[1].classList.add('core-hidden');   // "A NEW DIMENSION"
    if (kids[2]) kids[2].classList.add('core-legacy');   // revealed by "More…"

    var box = document.createElement('div');
    box.id = 'coreStart';

    var main = document.createElement('div');
    main.className = 'core-main';
    var bot = document.createElement('button');
    bot.className = 'core-btn'; bot.id = 'coreBotBtn';
    bot.textContent = 'vs Computer';
    bot.addEventListener('click', function () { startGame('bot'); });
    var local = document.createElement('button');
    local.className = 'core-btn'; local.id = 'coreLocalBtn';
    local.textContent = '2 Players';
    local.addEventListener('click', function () { startGame('local'); });
    main.appendChild(bot); main.appendChild(local);
    box.appendChild(main);

    box.appendChild(chipRow('Bot', 'diff',
      [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['max', 'Max']],
      coreDiff, function (v) { coreDiff = v; writePref('core_diff', v); }));
    box.appendChild(chipRow('You', 'color',
      [['white', 'White'], ['black', 'Black'], ['random', 'Random']],
      coreColor, function (v) { coreColor = v; writePref('core_color', v); }));

    var more = document.createElement('button');
    more.id = 'coreMoreBtn';
    more.textContent = 'More…';
    more.title = 'Puzzles, online play, replays, settings';
    more.addEventListener('click', function () {
      if (typeof SND !== 'undefined') SND.ui();
      var open = mm.classList.toggle('core-more');
      more.textContent = open ? 'Less' : 'More…';
    });
    box.appendChild(more);

    mm.insertBefore(box, kids[1] || null);
  }

  /* ======================================================================
     3. CORNER DOCK
     ====================================================================== */
  var ICONS = {
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    exitFull:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    background: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" class="fill"/></svg>'
  };

  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fsSupported() {
    var d = document.documentElement;
    return !!(d.requestFullscreen || d.webkitRequestFullscreen);
  }
  function toggleFullscreen() {
    var d = document.documentElement;
    try {
      if (fsElement()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        var p = (d.requestFullscreen || d.webkitRequestFullscreen).call(d);
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
  }
  window.coreToggleFullscreen = toggleFullscreen;

  function syncFullscreenBtn() {
    var b = $('coreFsBtn');
    if (!b) return;
    var on = !!fsElement();
    b.innerHTML = on ? ICONS.exitFull : ICONS.fullscreen;
    b.title = on ? 'Exit fullscreen (P)' : 'Fullscreen (P)';
    b.classList.toggle('on', on);
  }

  function buildDock() {
    var dock = document.createElement('div');
    dock.id = 'coreDock';

    // Moved in from the cozy top bar / dock; listeners and ids survive.
    ['viewToggle', 'rotateBoardBtn'].forEach(function (id) {
      var el = $(id);
      if (el) dock.appendChild(el);
    });

    var fs = document.createElement('button');
    fs.id = 'coreFsBtn';
    fs.className = 'core-icon';
    fs.addEventListener('click', toggleFullscreen);
    if (!fsSupported()) fs.style.display = 'none';
    dock.appendChild(fs);

    var bg = document.createElement('button');
    bg.id = 'coreBgBtn';
    bg.className = 'core-icon';
    bg.innerHTML = ICONS.background;
    bg.addEventListener('click', cycleBackground);
    dock.appendChild(bg);

    var hide = $('uiHideBtn');
    if (hide) { hide.title = 'Hide controls (H)'; dock.appendChild(hide); }

    document.body.appendChild(dock);
    syncFullscreenBtn();
    applyBackground(coreBg);   // refresh the button title
    document.addEventListener('fullscreenchange', syncFullscreenBtn);
    document.addEventListener('webkitfullscreenchange', syncFullscreenBtn);
  }

  /* ======================================================================
     4. IDLE DIMMING — controls fade back after a few seconds without input
     during a match, so a projected board is not framed by buttons.
     ====================================================================== */
  var IDLE_MS = 4000, _idleT = 0;
  function wake() {
    document.body.classList.remove('core-idle');
    clearTimeout(_idleT);
    _idleT = setTimeout(function () { document.body.classList.add('core-idle'); }, IDLE_MS);
  }
  ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
    window.addEventListener(ev, wake, { passive: true, capture: true });
  });

  // The online status pill is only useful during an online match.
  setInterval(function () {
    var online = typeof ONLINE !== 'undefined' && !!ONLINE.inMatch;
    document.body.classList.toggle('core-online', online);
  }, 1000);

  /* ======================================================================
     5. CAMERA FRAMING
     TILT and FREE use fixed camera distances tuned for one window shape, so
     on wide or tall displays the top layer ran off-screen. Keep the original
     viewing angle, aim at the centre of the stack and back off just far
     enough that all four layers (plus coordinates and pieces) fit inside the
     viewport minus the HUD margins. FLAT and SLICE are left as they were.
     ====================================================================== */
  var _v = new THREE.Vector3();

  function stackCorners() {
    if (typeof layers === 'undefined' || !layers.length) return null;
    pivot.updateMatrixWorld(true);
    var h = half + 0.6;                    // squares + slab rim + coordinate labels
    var pts = [];
    for (var z = 0; z < layers.length; z++) {
      var ys = (z === layers.length - 1) ? [-0.4, 1.6] : [-0.4];   // top layer: piece height
      if (z === 0) ys = [-0.6, 0.4];
      ys.forEach(function (y) {
        [[-h, -h], [h, -h], [-h, h], [h, h]].forEach(function (c) {
          pts.push(layers[z].localToWorld(new THREE.Vector3(c[0], y, c[1])));
        });
      });
    }
    return pts;
  }

  function fits(pts, pos, look, box) {
    var cam = camera.clone();
    cam.position.copy(pos); cam.lookAt(look);
    cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    for (var i = 0; i < pts.length; i++) {
      _v.copy(pts[i]).project(cam);
      if (_v.z > 1 || _v.x < box.l || _v.x > box.r || _v.y < box.b || _v.y > box.t) return false;
    }
    return true;
  }

  function viewBox() {
    var W = window.innerWidth, H = window.innerHeight;
    var side = Math.min(64, W * 0.06), top = Math.min(72, H * 0.1), bottom = Math.min(24, H * 0.04);
    return { l: -1 + 2 * side / W, r: 1 - 2 * side / W, t: 1 - 2 * top / H, b: -1 + 2 * bottom / H };
  }

  function fitTarget(orig) {
    var pts = stackCorners();
    if (!pts) return orig;
    var c = new THREE.Vector3();
    pts.forEach(function (p) { c.add(p); });
    c.multiplyScalar(1 / pts.length);
    var dir = orig.pos.clone().sub(orig.look).normalize();
    var box = viewBox();
    var lo = 4, hi = 120;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (fits(pts, c.clone().addScaledVector(dir, mid), c, box)) hi = mid; else lo = mid;
    }
    return { pos: c.clone().addScaledVector(dir, hi), look: c };
  }

  if (typeof camGetTarget === 'function' && typeof CAMERA_MODES !== 'undefined') {
    var _camGetTarget = camGetTarget;
    camGetTarget = function (mode, z) {
      var t = _camGetTarget(mode, z);
      if (mode !== CAMERA_MODES.TILT && mode !== CAMERA_MODES.FREE) return t;
      return fitTarget(t);
    };
  }

  // Snap the camera to the framed position for the current mode.
  function refit() {
    if (typeof cameraMode === 'undefined') return;
    if (cameraMode !== CAMERA_MODES.TILT && cameraMode !== CAMERA_MODES.FREE) return;
    var t = camGetTarget(cameraMode, activeZ);
    camera.position.copy(t.pos);
    _camLookAt.copy(t.look);
    camera.lookAt(t.look);
    camera.updateProjectionMatrix();
    _camTrans.active = false;
  }
  window.coreRefitCamera = refit;

  // startLocalGame() re-orients the board for the player's side (setPOV), so
  // frame it after that; resizes (fullscreen, projector resolution) too.
  if (typeof startLocalGame === 'function') {
    var _startLocalGame = startLocalGame;
    startLocalGame = function () {
      var r = _startLocalGame.apply(this, arguments);
      refit();
      return r;
    };
  }
  var _rzT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(_rzT);
    _rzT = setTimeout(refit, 120);
  });

  /* ======================================================================
     KEYBOARD — B background · H hide controls · P fullscreen
     (F and R already flip the board, V cycles the camera, Q/E change layer.)
     ====================================================================== */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'b') { cycleBackground(); }
    else if (k === 'p') { toggleFullscreen(); }
    else if (k === 'h') { var hb = $('uiHideBtn'); if (hb) hb.click(); }
  });

  /* ======================================================================
     SETTINGS — the background pages drive a system this build pins to a
     plain colour, so their controls are hidden rather than left inert.
     ====================================================================== */
  function trimSettings() {
    var chips = $('bBgTypeChips');
    var sec = chips && chips.closest('.settingSection');
    if (sec) sec.classList.add('core-hidden');
    document.querySelectorAll('[data-adv="pageBackground"], [data-page="pageBackground"]').forEach(function (b) {
      b.classList.add('core-hidden');
    });
  }

  function boot() {
    buildStart();
    buildDock();
    trimSettings();
    refit();
    wake();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
