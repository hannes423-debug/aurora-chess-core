/* ============================================================================
   26_cozy_icons.js — one icon language for the whole UI.

   The problem this solves: the UI's symbols were a pile of unrelated glyphs —
   💡 🧩 📽 ⚙ 👤 🚩 ⚡ 🤖 🌐 next to ◈ ⚑ ✥ ⬡ ♟ ☰. Half of them are
   emoji-presentation by default, so the browser hands them to the colour emoji
   font and they land on the pastel pills as saturated multi-colour stickers —
   a yellow lightbulb, an orange flag, a green gear — that belong to no palette
   at all. The other half are box-drawing characters that depend on a system
   font being present and render as a tofu box when it is not.

   The fix is the one css/cozy-ui.css already applies to #uiHideBtn and the
   piece-preset chevrons: blank the glyph and paint an inline SVG instead. Every
   icon is a 24×24 line drawing at stroke-width 2 with round caps and joins,
   coloured by the palette, so they read as one set.

   This file does one half of that — clearing the glyph out of the text — and
   css/cozy-ui.css does the other. It is a text edit, NOT a DOM edit: the icon
   never becomes a child node, because several of these buttons have their
   textContent rewritten wholesale by other modules (#layerVisToggle cycles
   LTD/ALL, #uiHideBtn swaps ◻/▣) and a child element would simply be deleted
   on the next interaction. Same reasoning as the ✦ in #hud being a ::before.
   The MutationObserver re-strips whatever a rewrite puts back.
   ========================================================================== */
(function () {
  'use strict';

  /* Element id → icon name. The matching .cz-ico-<name> rule in cozy-ui.css
     carries the actual artwork. */
  var MAP = {
    /* ── in-game top bar ── */
    menuBtn:            'menu',
    rotateBoardBtn:     'rotate',
    hintBtn:            'bulb',
    undoBtn:            'undo',
    puzzleInfoToggle:   'info',
    layerVisToggle:     'layers',
    threatVisionToggle: 'scan',
    panBoardBtn:        'pan',
    hudGearBtn:         'sliders',

    /* ── main menu ── */
    mainPlayBtn:        'play',
    mainPuzzlesBtn:     'puzzle',
    mainReviewBtn:      'film',
    mainSettingsBtn:    'gear',
    mainProfileBtn:     'user',
    mainSupportBtn:     'heart',
    mainLoginBtn:       'login',

    /* ── play flow ── */
    ps1Standard:        'pawn',
    ps1Arcade:          'zap',
    ps1CTF:             'flag',
    ps2Local:           'users',
    ps2Bot:             'bot',
    ps2Online:          'globe',
    ps1Back:            'back',
    ps2Back:            'back',
    ps3Back:            'back',
    ps3Play:            'play',
    helpBackBtn:        'back'
  };

  /* One leading symbol plus the space after it. Anchored and non-greedy on
     purpose: "⟳ 180°" must lose the ⟳ and keep the ° , and "← Back" must lose
     the ← and keep "Back". \p{L}\p{N} with the u flag is what makes this work
     on the astral-plane emoji (🧩 🤖 🚩) as well as the BMP glyphs. */
  var LEAD = /^[\s‍️]*[^\p{L}\p{N}\s][\s‍️]*/u;

  /* Strip only the FIRST text node, so the <div class="sub"> subtitle inside
     the mode cards is never touched. */
  function stripGlyph(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType !== 3) continue;              // element → past the label
      if (!n.nodeValue.trim()) continue;           // whitespace-only, keep going
      var next = n.nodeValue.replace(LEAD, '');
      if (next !== n.nodeValue) n.nodeValue = next;
      return next.trim();
    }
    return '';
  }

  function apply(el, name) {
    var rest = stripGlyph(el);
    el.classList.add('cz-ico', 'cz-ico-' + name);
    /* An icon with nothing left beside it is centred rather than inset, and
       needs a floor on its width or the emptied button collapses to its
       padding. The class is what cozy-ui.css keys that on. */
    el.classList.toggle('cz-ico-only', rest === '');
  }

  function sweep() {
    Object.keys(MAP).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      apply(el, MAP[id]);
      if (el._czIcoWatched) return;
      el._czIcoWatched = true;
      /* Re-strip after any rewrite. Guarded with a flag rather than
         disconnect/reconnect because our own nodeValue write would otherwise
         retrigger the observer and recurse. */
      new MutationObserver(function () {
        if (el._czIcoBusy) return;
        el._czIcoBusy = true;
        try { apply(el, MAP[id]); } finally { el._czIcoBusy = false; }
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  function init() {
    sweep();
    /* Several of these buttons are created or revealed well after boot (the
       play-flow steps, the dock). A couple of late sweeps is cheaper and far
       more predictable than observing the whole document. */
    setTimeout(sweep, 400);
    setTimeout(sweep, 1600);
    window.czSweepIcons = sweep;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
