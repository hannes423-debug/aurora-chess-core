/* ==========================================================================
   AURORA CHESS — COZY UI  (presentation layer)
   --------------------------------------------------------------------------
   Loads after the game modules (js/30_core.js trims it further). Owns:

     1. (background artwork — removed in Aurora Chess Core)
     2. reflowing the existing top-bar buttons into two soft rounded rows
     3. the turn-indicator pill's states and entry animation
     4. the bottom dock (Quick · theme carousel · ? · window toggle)

   Design rule followed throughout: elements are MOVED, never recreated.
   appendChild re-parents a node while keeping its id, its inline handlers and
   every addEventListener binding intact, so all existing game wiring — the
   gamepad code that synthesises .click(), the show/hide passes that set
   style.display, applyUIStyle()'s inline repaints — keeps working untouched.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ======================================================================
     1. BACKGROUND ARTWORK — removed in Aurora Chess Core.
     The landscape artwork layer and its pointer/tilt parallax competed with
     the board; the page background is now a plain configurable colour owned
     by js/30_core.js.
     ====================================================================== */

  /* ======================================================================
     2. TOP CONTROL AREA
     ====================================================================== */

  var topBar = null;

  function buildTopBar() {
    topBar = document.createElement('div');
    topBar.id = 'czTopBar';

    var row1 = document.createElement('div');
    row1.id = 'czTopRow1'; row1.className = 'cz-toprow';
    var row2 = document.createElement('div');
    row2.id = 'czTopRow2'; row2.className = 'cz-toprow';

    // Row 1: ☰ · ⟳180° · 💡 · ↶ · ℹ ·······  MOVES · FREE
    adopt(row1, ['menuBtn', 'rotateBoardBtn', 'hintBtn', 'undoBtn', 'puzzleInfoToggle']);
    var spacer = document.createElement('span');
    spacer.id = 'czSpacer';
    row1.appendChild(spacer);
    adopt(row1, ['moveToggle', 'viewToggle']);

    // Row 2: ALL · TTS ······················· PAN
    adopt(row2, ['layerVisToggle', 'threatVisionToggle', 'panBoardBtn']);

    topBar.appendChild(row1);
    topBar.appendChild(row2);

    // Row 3: the turn indicator, centred under the controls
    var hud = $('hud');
    if (hud) topBar.appendChild(hud);

    document.body.appendChild(topBar);
    measureTopBar();
  }

  function adopt(row, ids) {
    ids.forEach(function (id) {
      var el = $(id);
      if (el) row.appendChild(el);   // keeps id + all listeners
    });
  }

  /* Publish the bar's real height so things that used to be positioned against
     the old toolbar (arcade bar, move panel, puzzle popup…) can sit below it.
     Measured, not assumed — the rows grow and shrink as buttons show and hide. */
  function measureTopBar() {
    if (!topBar) return;
    var h = topBar.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--cz-topbar-h', Math.round(h) + 'px');
  }

  /* ======================================================================
     3. TURN INDICATOR
     ====================================================================== */

  function initHud() {
    var hud = $('hud');
    if (!hud) return;

    // Replay the entry animation whenever the game rewrites the turn text.
    var mo = new MutationObserver(function () {
      hud.classList.remove('cz-hud-enter');
      void hud.offsetWidth;              // force reflow so the animation restarts
      hud.classList.add('cz-hud-enter');
      measureTopBar();
    });
    mo.observe(hud, { childList: true, characterData: true, subtree: true });

    // Check state rides on the existing board-message system rather than on a
    // second source of truth: showBoardMsg('check') is already the one call
    // every code path makes when a king is in check.
    if (typeof window.showBoardMsg === 'function') {
      var _origShowBoardMsg = window.showBoardMsg;
      window.showBoardMsg = function (key) {
        try {
          if (key === 'check' || key === 'checkmate') {
            hud.classList.add('cz-check');
          } else if (key === 'start') {
            hud.classList.remove('cz-check');
          }
        } catch (e) { /* never let decoration break the game */ }
        return _origShowBoardMsg.apply(this, arguments);
      };
    }
    // A completed move that did not raise check clears the blush wash.
    if (typeof window.executeMove === 'function') {
      var _origExecuteMove = window.executeMove;
      window.executeMove = function () {
        hud.classList.remove('cz-check');
        return _origExecuteMove.apply(this, arguments);
      };
    }
  }

  /* ======================================================================
     4. BOTTOM DOCK
     ====================================================================== */

  /* Theme cards. Every entry drives the EXISTING theme functions — this is a
     friendlier front end for them, not a second theming system. */
  var CZ_THEMES = [
    {
      id: 'aurora', label: 'Aurora',
      swatch: 'linear-gradient(160deg,#6f7fd8 0%,#8fd6e8 55%,#9fe0d2 100%)',
      dots: ['#f6f1e6', '#d8d3f2', '#9fe0d2', '#8fd6e8', '#a99fe0'],
      apply: function () { setCosmicGlass(true); setBoardPalette('aurora'); }
    },
    {
      id: 'midnight', label: 'Midnight',
      swatch: 'linear-gradient(160deg,#2b2a63 0%,#3c3a86 60%,#4a48a6 100%)',
      dots: ['#e6e3ff', '#b9b3ee', '#8f8ad8', '#6f6ac0', '#4a48a6'],
      apply: function () { setCosmicGlass(true); setBoardPalette('midnight'); }
    },
    {
      id: 'jade', label: 'Jade',
      swatch: 'linear-gradient(160deg,#20543f 0%,#2f7d5c 60%,#4aa87c 100%)',
      dots: ['#eafaf0', '#b6e8cd', '#84d3ab', '#57b98a', '#2f7d5c'],
      apply: function () { setCosmicGlass(true); setBoardPalette('jade'); }
    },
    {
      id: 'classic', label: 'Classic',
      swatch: 'linear-gradient(160deg,#2a2a2a 0%,#141414 60%,#050505 100%)',
      dots: ['#dddddd', '#aaaaaa', '#777777', '#484848', '#242424'],
      apply: function () { setCosmicGlass(false); applyExisting('applySquareTheme', 'classic'); }
    }
  ];

  function applyExisting(fnName, arg) {
    var fn = window[fnName];
    if (typeof fn === 'function') { try { fn(arg); } catch (e) { console.warn('[cozy-ui]', fnName, e); } }
  }

  function setCosmicGlass(on) {
    // cosmicGlassActive is a plain `let` in 03_scene.js — not on window — so
    // read it through the accessor the scene module exposes where available,
    // and otherwise just call the apply/revert pair, which both no-op when the
    // state already matches.
    if (on) applyExisting('applyCosmicGlassTheme');
    else    applyExisting('revertCosmicGlassTheme');
  }

  function setBoardPalette(name) {
    // Implemented in js/25_cozy_scene.js (3D side). Guarded so the UI still
    // works if the scene module is absent.
    if (typeof window.czApplyBoardPalette === 'function') window.czApplyBoardPalette(name);
  }

  var dock = null;

  function buildDock() {
    dock = document.createElement('div');
    dock.id = 'czDock';

    // Quick — the existing #hudGearBtn, moved in as-is
    var gear = $('hudGearBtn');
    if (gear) dock.appendChild(gear);

    // The theme carousel that used to sit here was removed on request — it read
    // as a stray bar of coloured boxes above the status line. CZ_THEMES and
    // restoreThemeSelection() stay: the saved (or default Aurora) entry is still
    // what turns cosmic glass on at boot, so deleting them would strip the board.
    // The COSMIC GLASS / CLASSIC chips in Settings remain the visible switch.

    // ? — opens the existing help overlay
    var help = document.createElement('button');
    help.type = 'button';
    help.id = 'czHelpBtn';
    help.textContent = '?';
    help.title = 'How to play';
    help.setAttribute('aria-label', 'How to play');
    help.addEventListener('click', function () {
      if (window.SND && typeof SND.ui === 'function') SND.ui();
      /* Go through openHelpOverlay() rather than setting display directly:
         it records whether the main menu was showing, which is what lets the
         close button put the player back in the match instead of the menu. */
      if (typeof window.openHelpOverlay === 'function') { window.openHelpOverlay(); return; }
      var overlay = $('helpOverlay');
      if (overlay) { overlay.style.display = 'flex'; return; }
      var tut = $('tutorialOverlay');
      if (tut) tut.style.display = 'flex';
    });
    dock.appendChild(help);

    // The window / UI-visibility toggle, moved in from its floating position
    var hideBtn = $('uiHideBtn');
    if (hideBtn) dock.appendChild(hideBtn);

    document.body.appendChild(dock);
    restoreThemeSelection();
  }

  function selectThemeCard(id) {
    if (!dock) return;
    dock.querySelectorAll('.cz-theme-card').forEach(function (c) {
      c.classList.toggle('cz-on', c.dataset.czTheme === id);
    });
  }

  function restoreThemeSelection() {
    var saved = null;
    try { saved = localStorage.getItem('cc_cozy_theme'); } catch (e) {}
    // Default to Aurora, the palette the redesign is built around.
    var id = saved || 'aurora';
    var entry = CZ_THEMES.filter(function (t) { return t.id === id; })[0];
    if (!entry) { entry = CZ_THEMES[0]; id = entry.id; }
    selectThemeCard(id);
    // Cosmic glass IS the redesign — the stacked pastel slabs are the whole
    // look, so the three glass themes turn it on at boot rather than waiting
    // for the user to tap a card. `Classic` remains the way to switch it off,
    // and because that choice is saved as cc_cozy_theme it still survives a
    // reload. Order matters: the slabs must exist before the palette can
    // round their corners and retint them.
    entry.apply();
  }

  /* The dock shares the gameplay lifecycle of the Quick button it contains:
     the game already shows/hides #hudGearBtn at exactly the right moments, so
     mirroring it needs no new hooks into game state. */
  function watchDockVisibility() {
    var gear    = $('hudGearBtn');
    var hideBtn = $('uiHideBtn');
    if (!dock || !gear) return;

    function sync() {
      // The dock is on screen whenever the Quick button is — the game already
      // shows and hides that at exactly the right moments.
      dock.classList.toggle('cz-visible', gear.style.display !== 'none');
      // …but while the UI is hidden only the window toggle itself stays lit,
      // otherwise there would be no way to bring the interface back.
      dock.classList.toggle('cz-uihidden', !!window._uiHidden);
      if (window._uiHidden) dock.classList.add('cz-visible');
      if (hideBtn) hideBtn.classList.toggle('cz-on', !!window._uiHidden);
    }

    new MutationObserver(sync).observe(gear, { attributes: true, attributeFilter: ['style'] });
    // Runs after 19_online.js's own handler has flipped window._uiHidden.
    if (hideBtn) hideBtn.addEventListener('click', function () { setTimeout(sync, 0); });
    sync();
  }

  /* Marks <body> while a game is actually on screen.

     Several in-game controls have no menu-state gating at all — #hud,
     #moveToggle and #viewToggle are created visible and only ever hidden by
     the UI-hide toggle — so the main menu was showing "White to move", MOVES
     and TILT over the title, and #onlineStatusBar's pill collided with the
     LOGIN / SIGN UP button beneath it. The controls the game does manage
     (#rotateBoardBtn, #hintBtn, #hudGearBtn …) are display:none in the markup
     and revealed by startLocalGame(), which is why they never leaked.

     The signal is the canvas's own pointer-events, which is what 11_camera.js
     already uses to decide pivot.visible — i.e. the codebase's existing
     definition of "a game is on screen", true for replay playback too. A class
     on <body> rather than imperative display writes, because 17_themes.js
     applyUIStyle() rewrites inline styles on these very elements on every call
     and would undo anything set here. */
  function watchGameActive() {
    if (typeof renderer === 'undefined' || !renderer.domElement) return;
    var canvas = renderer.domElement;
    function sync() {
      document.body.classList.toggle('cz-ingame', canvas.style.pointerEvents !== 'none');
    }
    new MutationObserver(sync).observe(canvas, { attributes: true, attributeFilter: ['style'] });
    sync();
  }

  /* ======================================================================
     5. LEGACY PALETTE SWEEP
     ----------------------------------------------------------------------
     css/cozy-ui.css can only reach what has an id or a class. Most of the
     text inside the overlays does not: it lives on anonymous <div>s and
     <span>s carrying the pre-redesign palette in a hardcoded style=""
     attribute (`color:#3a7a9b`, `font-family:monospace`, …). Those are the
     "relics" — 9px letterspaced cyan monospace over pastel artwork.

     So remap the palette itself. The table below is a WHITELIST of the old
     skin's chrome colours only; anything not listed is left alone, which is
     what keeps meaningful runtime colours (the online status dot, piece
     colours, per-theme accents) untouched.
     ====================================================================== */

  /* Keyed by "r,g,b" — the old skin expressed "dim" as low alpha on the same
     few hues, so the key ignores alpha but the REPLACEMENT does not.
     Each entry is [token, "r,g,b"]. The token is used when the source colour
     is opaque; when it carries an alpha the sweep rebuilds rgba() from the
     triple at that SAME alpha instead. That second form is not a nicety — the
     old skin encodes state as alpha on one hue (the wizard's step dots are
     #00e5ff at 1.0 for the current step and 0.12 for the rest), so collapsing
     both to one opaque token silently deletes which step you are on. */
  var CZ_INK = {
    /* sci-fi cyan family → the cozy ink ramp */
    '204,232,255': ['var(--cz-ink)',      '242,238,255'], /* #cce8ff headings   */
    '106,180,216': ['var(--cz-ink-soft)', '205,197,238'], /* #6ab4d8            */
    '74,143,176':  ['var(--cz-ink-soft)', '205,197,238'], /* #4a8fb0 row labels */
    '58,122,155':  ['var(--cz-lavender)', '169,159,224'], /* #3a7a9b captions   */
    '0,229,255':   ['var(--cz-mint)',     '159,224,210'], /* #00e5ff accent     */
    '0,204,255':   ['var(--cz-cyan)',     '143,214,232'], /* #00ccff            */
    '0,153,187':   ['var(--cz-ink-dim)',  '153,144,196'], /* #0099bb            */
    '0,119,170':   ['var(--cz-ink-dim)',  '153,144,196'], /* #0077aa            */
    /* These were near-black navies — readable on the old black page,
       invisible over the artwork. They are captions, so lift them. */
    '10,30,48':    ['var(--cz-ink-dim)',  '153,144,196'], /* #0a1e30            */
    '13,37,53':    ['var(--cz-ink-dim)',  '153,144,196'], /* #0d2535            */
    '6,21,32':     ['var(--cz-ink-dim)',  '153,144,196'], /* #061520            */
    /* neutral greys */
    '255,255,255': ['var(--cz-ink)',      '242,238,255'],
    '204,204,204': ['var(--cz-ink-soft)', '205,197,238'],
    '170,170,170': ['var(--cz-ink-soft)', '205,197,238'],
    '136,136,136': ['var(--cz-ink-soft)', '205,197,238'],
    '102,102,102': ['var(--cz-ink-dim)',  '153,144,196'],
    '85,85,85':    ['var(--cz-ink-dim)',  '153,144,196'],
    '68,68,68':    ['var(--cz-ink-dim)',  '153,144,196'],
    '51,51,51':    ['var(--cz-ink-dim)',  '153,144,196'],
    /* semantic — softened, but each keeps its signal */
    '0,255,136':   ['var(--cz-leaf)',     '143,216,168'], /* success / online   */
    '255,68,68':   ['var(--cz-rose)',     '245,145,159'], /* error              */
    '255,102,102': ['var(--cz-rose)',     '245,145,159'],
    '255,170,0':   ['var(--cz-gold)',     '242,208,138'], /* warning            */
    '255,136,0':   ['var(--cz-gold)',     '242,208,138'],
    '255,102,0':   ['var(--cz-gold)',     '242,208,138']
  };

  /* Dark navy fills and hairlines from the old panels. The accent borders are
     kept as accents — flattening an "active" cyan edge to a plain hairline
     would delete the state it was communicating, not restyle it. */
  var CZ_EDGE = {
    '6,21,32':    ['var(--cz-hairline)',     '226,222,255'], /* #061520 */
    '10,30,48':   ['var(--cz-hairline)',     '226,222,255'], /* #0a1e30 */
    '34,34,34':   ['var(--cz-hairline)',     '226,222,255'], /* #222    */
    '51,51,51':   ['var(--cz-hairline)',     '226,222,255'], /* #333    */
    '26,26,26':   ['var(--cz-hairline)',     '226,222,255'], /* #1a1a1a */
    '13,37,53':   ['var(--cz-hairline)',     '226,222,255'], /* #0d2535 */
    '58,122,155': ['var(--cz-hairline-lit)', '226,222,255'], /* #3a7a9b */
    '0,119,170':  ['var(--cz-hairline-lit)', '226,222,255'], /* #0077aa */
    /* The move panel draws its white/black square keys as bordered boxes —
       this edge IS the "white square" swatch, so it stays light. */
    '204,232,255':['var(--cz-ink)',          '242,238,255'], /* #cce8ff */
    '0,229,255':  ['rgba(159,224,210,0.55)', '159,224,210'], /* active  */
    '0,204,255':  ['rgba(159,224,210,0.45)', '159,224,210'],
    '0,255,136':  ['rgba(143,216,168,0.55)', '143,216,168'], /* success */
    '255,68,68':  ['rgba(245,145,159,0.55)', '245,145,159'], /* danger  */
    '255,170,0':  ['rgba(242,208,138,0.55)', '242,208,138']  /* warning */
  };
  var CZ_FILL = {
    '4,12,22':   ['var(--cz-surface-soft)', '108,100,172'], /* #040c16 */
    '17,17,17':  ['var(--cz-surface-soft)', '108,100,172'], /* #111    */
    '26,26,26':  ['var(--cz-surface-soft)', '108,100,172'], /* #1a1a1a */
    '5,5,5':     ['var(--cz-surface-soft)', '108,100,172'], /* #050505 */
    '10,10,10':  ['var(--cz-surface-soft)', '108,100,172'], /* #0a0a0a — the
                    bot menu's OFF pills, which stayed black holes */
    '6,21,32':   ['var(--cz-surface-soft)', '108,100,172'], /* slider tracks */
    '13,37,53':  ['var(--cz-surface)',      '88,80,150'],   /* toggle thumbs */
    '0,24,51':   ['var(--cz-surface)',      '88,80,150'],   /* #001833 */
    /* Filled accents: the wizard's step dots and the unread badge. Both are
       state, so they keep a saturated fill — just a cozy one. */
    '0,229,255': ['var(--cz-mint)',         '159,224,210'], /* #00e5ff */
    '255,68,68': ['var(--cz-rose)',         '245,145,159']  /* #ff4444 */
  };

  /* The overlays this sweep is allowed to touch. Deliberately NOT document.body:
     the in-game HUD is owned by section 2 and by 17_themes.js applyUIStyle(),
     and repainting it from here would fight both. */
  var CZ_SWEEP_ROOTS = [
    'mainMenu', 'modeMenu', 'botMenu', 'pauseMenu', 'endMenu', 'reviewMenu',
    'playStep1', 'playStep2', 'playStep3', 'playStepOnline',
    'settingsOverlay', 'uiSettingsOverlay', 'onlineLobby', 'accountOverlay',
    'profileOverlay', 'helpOverlay', 'gameHelpPanel', 'gameHelpOverlay',
    'friendPanel', 'tutorialOverlay', 'puzzleSelectOverlay', 'puzzleInfoPopup',
    'puzzleSuccess', 'supportOverlay', 'welcomeWizard', 'promotionPopup',
    'promotionWait', 'hudQuickPanel', 'chessClock', 'movePanel',
    'reviewControls', 'arcadeBar', 'gpHintBar', 'layoutToolbar',
    // Built in 19_online.js and rewritten on every status change — their
    // inner <span>s carry the old #ffaa00 / #00ff88 status colours.
    'onlineStatusBar', 'onlineWidget', 'offlineBanner'
  ];

  /* Looks `v` up in `map` and returns the replacement, preserving the source
     alpha. Returns null when the colour is not a legacy one — which is what
     leaves every runtime-meaningful colour in the game untouched. */
  function czMap(map, v) {
    if (!v) return null;
    var m = v.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (!m) return null;
    var hit = map[m[1] + ',' + m[2] + ',' + m[3]];
    if (!hit) return null;
    var a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a >= 1) return hit[0];
    if (a <= 0) return null;              // fully transparent: nothing to restyle
    return 'rgba(' + hit[1] + ',' + a + ')';
  }

  /* Reads COMPUTED style, not el.style.
     The first version of this sweep only looked at inline style="" attributes
     and left 536 relics behind, because most of the old palette is declared in
     the two <style> blocks in index.html — `.playPanel { color:#cce8ff }` and
     friends — which no inline read can see. Computed style catches both, and
     writing the replacement back as an inline !important beats every legacy
     rule without having to enumerate hundreds of selectors.

     Only values in the whitelists above are ever written, so anything the game
     colours meaningfully at runtime passes through untouched. */
  function czSweepEl(el) {
    var s = el.style;
    if (!s) return;
    var c = window.getComputedStyle(el);
    if (!c) return;

    var ink = czMap(CZ_INK, c.color);
    if (ink) s.setProperty('color', ink, 'important');

    // Monospace was the old skin's whole voice. Nothing keeps it.
    if (/mono/i.test(c.fontFamily || '')) {
      s.setProperty('font-family', 'var(--cz-font)', 'important');
      // 1–2px letter-spacing reads as "terminal" in a rounded face.
      if (parseFloat(c.letterSpacing) > 0.8) s.setProperty('letter-spacing', '0.4px', 'important');
    }

    // Borders, per side: the legacy panels set them individually as often as
    // with the shorthand, and a shorthand write would invent edges that the
    // original never drew.
    ['Top', 'Right', 'Bottom', 'Left'].forEach(function (side) {
      if (parseFloat(c['border' + side + 'Width']) <= 0) return;
      var edge = czMap(CZ_EDGE, c['border' + side + 'Color']);
      if (edge) s.setProperty('border-' + side.toLowerCase() + '-color', edge, 'important');
    });

    var fill = czMap(CZ_FILL, c.backgroundColor);
    if (fill) s.setProperty('background-color', fill, 'important');

    // Square corners on a control are the loudest leftover of the old skin.
    // Only lift genuinely sharp ones — anything already rounded was styled on
    // purpose by cozy-ui.css and must not be flattened to a single radius.
    var tag = el.tagName;
    if ((tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') &&
        parseFloat(c.borderRadius) <= 4) {
      s.setProperty('border-radius', 'var(--cz-r-sm)', 'important');
    }

    el.dataset.czSwept = '1';
  }

  /* Every element, not just [style] ones — a CSS-declared colour leaves no
     inline attribute to filter on. The czSwept flag keeps repeat sweeps cheap:
     after the first pass only newly inserted nodes do any work. */
  function czSweep(root) {
    if (!root) return;
    if (root.dataset.czSwept !== '1') czSweepEl(root);
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].dataset && all[i].dataset.czSwept !== '1') czSweepEl(all[i]);
    }
  }

  /* Several panels rebuild their innerHTML long after boot (the online lobby
     on every status change, the profile on every load), which would restore
     the old palette. Re-sweep on mutation, debounced, and scoped to the
     panel that actually changed. Setting a style inside the sweep cannot
     retrigger it: the written value is a var(...) string, which never
     matches an rgb() key, and the element is flagged czSwept either way. */
  function czWatchOverlays() {
    var pending = null;
    var dirty = [];

    function flush() {
      pending = null;
      var seen = dirty.splice(0, dirty.length);
      for (var i = 0; i < seen.length; i++) czSweep(seen[i]);
    }

    CZ_SWEEP_ROOTS.forEach(function (id) {
      var root = $(id);
      if (!root) return;
      czSweep(root);
      new MutationObserver(function () {
        if (dirty.indexOf(root) === -1) dirty.push(root);
        if (!pending) pending = setTimeout(flush, 120);
      }).observe(root, { childList: true, subtree: true });
    });
  }

  /* ======================================================================
     BOOT
     ====================================================================== */

  function boot() {
    buildTopBar();
    initHud();
    buildDock();
    watchDockVisibility();
    watchGameActive();
    czWatchOverlays();

    window.addEventListener('resize', measureTopBar);

    // The rows change height as the game shows and hides individual buttons.
    if (window.ResizeObserver && topBar) new ResizeObserver(measureTopBar).observe(topBar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
