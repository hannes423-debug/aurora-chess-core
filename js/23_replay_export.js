/* ============================================================================
   23_replay_export.js — Flag Raid portable replay export & viewer
   ----------------------------------------------------------------------------
   Replaces the old GIF screen-recording with a self-contained, INTERACTIVE
   replay file. Everything the cinematic replay needs already lives in three
   arrays the game records as you play:
       moveLog[]   — { number, turn, piece, from, to, capture, moveColor, flag* }
       history[]   — { from:{x,y,z}, to:{x,y,z} }   (one per ply)
       snapshots[] — JSON string of every piece's full state, one per ply
   loadHistory(i) rebuilds the exact board from snapshots[i]; 21_replay.js's
   paintFog() reconstructs fog-of-war from piece positions. So a replay needs
   NO rules engine — only that data plus the render modules.

   This module:
     1. buildPayload()        — serialize the recorded game to clean JSON.
     2. buildStandaloneHTML() — inline-clone the running game (Three.js is
                                already an inline blob in index.html; the js/
                                modules are fetched + inlined) and inject the
                                payload, producing one offline .html file.
     3. download()            — save that file to the player's device.
     4. Boot detection        — if a file is opened with window.FLAG_RAID_REPLAY
                                set, it boots straight into the replay viewer.
     5. Review menu           — paste a payload (or drop an exported .html) and
                                watch / re-save it, from the main menu.
   The viewer UI itself is the combined review bar in 21_replay.js (scrub +
   step + play/pause + ⬇ save).
   ============================================================================ */
(function initReplayExport() {

  var EX = {};
  window.CTFExport = EX;

  /* ── tiny status toast (own DOM, never part of the export) ── */
  var toastEl, toastTimer;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'CTFExportToast';
      toastEl.style.cssText =
        'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:95;' +
        'display:none;font-family:monospace;font-size:12px;letter-spacing:0.5px;color:#f0dcb0;' +
        'background:rgba(8,5,2,0.94);border:1px solid #6a3a16;border-radius:8px;padding:9px 14px;' +
        'box-shadow:0 6px 26px rgba(0,0,0,0.6);max-width:90vw;text-align:center;';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    if (ms !== 0) toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, ms || 2600);
  }

  /* ── current color preset (so the exported board matches the live theme) ── */
  function currentTheme() {
    try { var b = document.querySelector('[data-preset].active'); return b ? b.dataset.preset : null; }
    catch (e) { return null; }
  }

  /* ── 1. serialize ── */
  function buildPayload() {
    if (typeof history === 'undefined' || !history || !history.length) return null;
    var ml = moveLog.map(function (m) {
      var o = { number: m.number, turn: m.turn, piece: m.piece,
                from: { x: m.from.x, y: m.from.y, z: m.from.z },
                to:   { x: m.to.x,   y: m.to.y,   z: m.to.z },
                capture: !!m.capture, moveColor: m.moveColor };
      if (m.flagGlyph) o.flagGlyph = m.flagGlyph;
      if (m.flagEvent) o.flagEvent = m.flagEvent;
      return o;
    });
    var hist = history.map(function (h) {
      return { from: { x: h.from.x, y: h.from.y, z: h.from.z },
               to:   { x: h.to.x,   y: h.to.y,   z: h.to.z } };
    });
    var endText = document.getElementById('endText');
    return {
      v: 1,
      meta: {
        title:  'Aurora Chess',
        date:   new Date().toISOString().slice(0, 10),
        result: (endText && endText.textContent) || '',
        plies:  hist.length,
        theme:  currentTheme(),
        ctfMode: (typeof ctfMode !== 'undefined' && !!ctfMode)
      },
      moveLog:   ml,
      history:   hist,
      snapshots: snapshots.slice()   // already JSON strings — copy verbatim
    };
  }
  EX.buildPayload = buildPayload;

  function stamp() { return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16); }

  /* ── 2. build the self-contained file ── */
  // Always pull fresh from the server, never the HTTP cache — otherwise a stale
  // cached module (e.g. fetched by an earlier export) gets baked into the file.
  function freshText(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.text(); }); }

  async function buildStandaloneHTML(payload) {
    var srcUrl = location.href.split('#')[0].split('?')[0];
    var html = await freshText(srcUrl);

    // Inline every external js/ module (Three.js is already inline in index.html).
    var re = /<script\s+src="(js\/[^"]+)"\s*><\/script>/g, m, tags = [];
    while ((m = re.exec(html))) tags.push({ tag: m[0], src: m[1].split('?')[0] });
    for (var i = 0; i < tags.length; i++) {
      var code;
      try { code = await freshText(tags[i].src); }
      catch (e) { code = '/* could not inline ' + tags[i].src + ' */'; }
      code = code.replace(/<\/script>/gi, '<\\/script>');
      html = html.replace(tags[i].tag, '<script>\n' + code + '\n</script>');
    }

    var json = JSON.stringify(payload).replace(/<\/script>/gi, '<\\/script>');
    var inject = '<script>window.FLAG_RAID_REPLAY = ' + json + ';</script>\n';
    html = html.indexOf('</head>') !== -1 ? html.replace('</head>', inject + '</head>')
                                          : inject + html;
    return html;
  }
  EX.buildStandaloneHTML = buildStandaloneHTML;

  /* ── 3. download ── */
  var busy = false;
  async function download() {
    if (busy) return;
    var payload = buildPayload();
    if (!payload) { toast('No game recorded yet.'); return; }
    busy = true;
    toast('Building replay file…', 0);
    try {
      var html = await buildStandaloneHTML(payload);
      var blob = new Blob([html], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'aurora-chess-replay-' + stamp() + '.html';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Saved ✓  (' + (blob.size / 1048576).toFixed(1) + ' MB)');
    } catch (e) {
      toast('Export failed: ' + (e && e.message ? e.message : e), 4000);
    } finally { busy = false; }
  }
  EX.download = download;

  /* Copy just the JSON payload to the clipboard (shareable via the Review menu). */
  function copyData() {
    var payload = buildPayload();
    if (!payload) { toast('No game recorded yet.'); return; }
    navigator.clipboard.writeText(JSON.stringify(payload))
      .then(function () { toast('Replay data copied ✓'); },
            function () { toast('Clipboard blocked — use Download instead.'); });
  }
  EX.copyData = copyData;

  /* ── parse pasted text: a raw JSON payload OR a whole exported .html ── */
  function parseInput(text) {
    if (!text) return null;
    text = String(text).trim();
    var mm = text.match(/window\.FLAG_RAID_REPLAY\s*=\s*([\s\S]*?);<\/script>/);
    var raw = mm ? mm[1] : text;
    try { var o = JSON.parse(raw); if (o && o.history && o.snapshots) return o; } catch (e) {}
    return null;
  }
  EX.parseInput = parseInput;

  /* ── parse a copied MOVE LIST (no snapshots) into a list of plies ──
     Supports both notations the game can copy:
       • FRN  (move panel "copy"):  Pe2/1-e3/1   — square = file+rank/layer
       • PGN  (end-screen "Copy PGN"): e2-e4 / Qd1z1xd8z2 — z(layer) omitted for layer 1
     Move numbers / headers / comments are ignored; play order = text order. */
  function parseMoveText(text) {
    if (!text) return null;
    var body = String(text).replace(/^\s*\[[^\]]*\]\s*$/gm, '').replace(/^\s*;.*$/gm, '');
    var plies = [], m;
    // FRN: explicit /layer on both squares (unambiguous) — try first.
    var frn = /([PNBRQK])([a-h])([1-8])\/([1-4])([x\-])([a-h])([1-8])\/([1-4])/g;
    while ((m = frn.exec(body))) {
      plies.push({
        from: { x: m[2].charCodeAt(0) - 97, y: +m[3] - 1, z: +m[4] - 1 },
        to:   { x: m[6].charCodeAt(0) - 97, y: +m[7] - 1, z: +m[8] - 1 }
      });
    }
    if (plies.length) return plies;
    // PGN: optional piece letter, optional z-layer suffix (absent ⇒ layer 1).
    var pgn = /([PNBRQK]?)([a-h])([1-8])(?:z([1-4]))?([x\-])([a-h])([1-8])(?:z([1-4]))?/g;
    while ((m = pgn.exec(body))) {
      plies.push({
        from: { x: m[2].charCodeAt(0) - 97, y: +m[3] - 1, z: (m[4] ? +m[4] - 1 : 0) },
        to:   { x: m[6].charCodeAt(0) - 97, y: +m[7] - 1, z: (m[8] ? +m[8] - 1 : 0) }
      });
    }
    return plies.length ? plies : null;
  }
  EX.parseMoveText = parseMoveText;

  /* ── Reconstruct a game from a move list by re-simulating it through the real
     engine, regenerating the board snapshots the viewer needs. Returns a payload
     (same shape as buildPayload) or throws on an illegal/unmatched move.
     Runs synchronously with all match side effects (bot, sound, scoring, finale,
     win/end, pass-device overlay) temporarily muted, then restores everything. ── */
  function reconstructFromPlies(plies) {
    var noop = function () {};
    // Snapshot everything we touch so we can fully restore on success OR failure.
    var sv = {
      botColor: (typeof botColor !== 'undefined') ? botColor : null,
      turn:     (typeof turn !== 'undefined') ? turn : 'white',
      reviewing:(typeof reviewing !== 'undefined') ? reviewing : false,
      ctfMode:  (typeof ctfMode !== 'undefined') ? ctfMode : false,
      nofog:    window.TUT_NOFOG,
      moveNumber: (typeof moveNumber !== 'undefined') ? moveNumber : 1,
      ml: moveLog, hist: history, snaps: snapshots,
      endGame: (typeof endGame === 'function') ? endGame : null,
      announce: (typeof arcadeAnnounce === 'function') ? arcadeAnnounce : null,
      boardText: (typeof boardText === 'function') ? boardText : null,
      pointTarget: (window.CTF && CTF.pointTarget), firstMover: (window.CTF && CTF.firstMover),
      scorePoint: (window.CTF && CTF.scorePoint),
      finale: (window.CTFFinale && CTFFinale.play)
    };
    var sndSaved = {};
    function mute() {
      // Reconstruct as a standard game (kings kept, no CTF rules). A copied move
      // list carries no mode flag, and standard chess is the safe default.
      //
      // This flag is NOT redundant with the no-ops below. Swapping endGame and
      // boardText out only silences calls made INSIDE the muted window; the
      // threefold-repetition hook in 17_themes.js defers its check by 200ms and
      // the draw it declares by a further 1200ms, so a repetition anywhere in
      // the pasted game used to announce itself over the replay with the REAL
      // functions, after restore() had swapped them back. Any side effect that
      // outlives this window has to be suppressed at its own source.
      window._replayResim = true;
      botColor = null; ctfMode = false; window.TUT_NOFOG = true;
      if (sv.endGame) endGame = noop;
      if (sv.announce) arcadeAnnounce = noop;
      if (sv.boardText) boardText = noop;
      if (window.CTF) { CTF.pointTarget = Infinity; CTF.firstMover = 'white'; CTF.scorePoint = noop; }
      if (window.CTFFinale) CTFFinale.play = function (a, b, c, d, cb) { if (cb) cb(); };
      for (var k in SND) if (typeof SND[k] === 'function') { sndSaved[k] = SND[k]; SND[k] = noop; }
    }
    function restore() {
      botColor = sv.botColor; turn = sv.turn;
      if (typeof setReviewing === 'function') setReviewing(sv.reviewing); else reviewing = sv.reviewing;
      window.TUT_NOFOG = sv.nofog;
      if (sv.endGame) endGame = sv.endGame;
      if (sv.announce) arcadeAnnounce = sv.announce;
      if (sv.boardText) boardText = sv.boardText;
      if (window.CTF) { CTF.pointTarget = sv.pointTarget; CTF.firstMover = sv.firstMover; }
      // A game ending in a delivery queued setTimeout(CTF.scorePoint, 400) during
      // the sim. Restore the real scorePoint only AFTER that window so the deferred
      // call lands on the still-muted no-op and can't score/finale over the replay.
      if (window.CTF && sv.scorePoint) setTimeout(function () { CTF.scorePoint = sv.scorePoint; }, 900);
      if (window.CTFFinale && sv.finale) CTFFinale.play = sv.finale;
      for (var k in sndSaved) SND[k] = sndSaved[k];
      if (typeof animations !== 'undefined') animations.length = 0;
      // The re-run walked the whole game through the live engine, so its
      // position counts are sitting in the threefold tracker. Clear them or the
      // next real game inherits them and can draw early.
      if (typeof window.resetThreefoldHistory === 'function') window.resetThreefoldHistory();
      // Held past the deferred window above (200ms + 1200ms) rather than
      // cleared here, so a late callback still finds the flag set. Nothing can
      // start a real game inside that gap — the replay viewer is opening.
      setTimeout(function () { window._replayResim = false; }, 1600);
    }
    try {
      mute();
      // Fresh standard start position (full army incl. kings), no game UI.
      resetBoard(true);
      reviewing = false;
      for (var i = 0; i < plies.length; i++) {
        var pl = plies[i];
        var pc = occ(pl.from.x, pl.from.y, pl.from.z);
        if (!pc) throw new Error('no piece at move ' + (i + 1));
        turn = pc.userData.color;            // make logged moveColor correct
        var legal = getLegalMoves(pc), t = null;
        for (var j = 0; j < legal.length; j++)
          if (legal[j].x === pl.to.x && legal[j].y === pl.to.y && legal[j].z === pl.to.z) { t = legal[j]; break; }
        if (!t) throw new Error('illegal move ' + (i + 1));
        executeMove(pc, t);
        if (typeof promotionActive !== 'undefined' && promotionActive && typeof resolvePromotion === 'function')
          resolvePromotion('queen');         // text has no promotion choice → default queen
      }
      if (!history.length) throw new Error('no moves found');
      var payload = {
        v: 1,
        meta: { title: 'Aurora Chess', date: new Date().toISOString().slice(0, 10), plies: history.length, imported: 'moves', ctfMode: false },
        moveLog: moveLog.map(function (m2) {
          var o = { number: m2.number, turn: m2.turn, piece: m2.piece,
                    from: { x: m2.from.x, y: m2.from.y, z: m2.from.z },
                    to:   { x: m2.to.x,   y: m2.to.y,   z: m2.to.z },
                    capture: !!m2.capture, moveColor: m2.moveColor };
          if (m2.flagGlyph) o.flagGlyph = m2.flagGlyph;
          if (m2.flagEvent) o.flagEvent = m2.flagEvent;
          return o;
        }),
        history: history.map(function (h) { return { from: { x: h.from.x, y: h.from.y, z: h.from.z }, to: { x: h.to.x, y: h.to.y, z: h.to.z } }; }),
        snapshots: snapshots.slice()
      };
      restore();
      return payload;
    } catch (e) {
      restore();
      moveLog = sv.ml; history = sv.hist; snapshots = sv.snaps;
      if (typeof moveNumber !== 'undefined') moveNumber = sv.moveNumber;
      ctfMode = sv.ctfMode;
      throw e;
    }
  }
  EX.reconstructFromPlies = reconstructFromPlies;

  /* ── 4 + 5. load a payload into the engine and open the review viewer ── */
  function loadPayload(payload, standalone) {
    if (!payload || !payload.history || !payload.history.length) return false;
    var RP = window.CTFReplay;
    if (!RP || !RP.start) return false;

    // Replay in the SAME mode the game was recorded in (fog/king-strip only for CTF).
    ctfMode = !!(payload.meta && payload.meta.ctfMode);
    window._ctfReviewUnlocked = true;        // full game freely reviewable (see 18_ctf_input)
    moveLog   = payload.moveLog   || [];
    history   = payload.history   || [];
    snapshots = payload.snapshots || [];
    if (typeof moveNumber !== 'undefined' && moveLog.length)
      moveNumber = moveLog[moveLog.length - 1].number;

    if (payload.meta && payload.meta.theme && typeof applyPreset === 'function') {
      try { applyPreset(payload.meta.theme); } catch (e) {}
    }
    // The render loop only shows the board (pivot.visible) when the canvas is
    // interactive — the game flips this on when a match starts. Do the same so
    // the board/pieces actually render in the replay viewer. (11_camera.js:387)
    if (typeof renderer !== 'undefined' && renderer.domElement)
      renderer.domElement.style.pointerEvents = 'auto';
    RP._standalone = !!standalone;
    // In-game review (not the exported file): the ✕ should return to the main
    // menu, not reveal a stale end-of-game screen.
    RP._onClose = standalone ? null : function () {
      if (typeof resetBoard === 'function') resetBoard(true);
      if (typeof renderer !== 'undefined' && renderer.domElement) renderer.domElement.style.pointerEvents = 'none';
      var mm = document.getElementById('mainMenu'); if (mm) mm.style.display = 'flex';
    };
    RP.start();
    return true;
  }
  EX.loadPayload = loadPayload;

  /* ===== Standalone viewer boot ===== */
  function isViewer() { return !!window.FLAG_RAID_REPLAY; }

  // Hide ALL game chrome in the standalone viewer with a CSS rule (not an
  // imperative sweep): this also covers nodes created/shown LATER — e.g. the
  // online module's connecting-status bars update over several seconds — and
  // the !important beats their inline `display:flex`. Only the 3D canvas, the
  // replay bar, and the export toast survive.
  function hideChrome() {
    if (document.getElementById('CTFViewerCSS')) return;
    var st = document.createElement('style');
    st.id = 'CTFViewerCSS';
    st.textContent =
      'body > *:not(canvas):not(#replayBar):not(#CTFExportToast):not(script):not(style):not(link)' +
      '{display:none !important;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function bootViewer() {
    var payload = window.FLAG_RAID_REPLAY;
    if (!payload) return;
    hideChrome();           // suppress menus/chrome immediately — no flash
    var tries = 0;
    (function waitReady() {
      var ready = window.CTFReplay && typeof resetBoard === 'function' &&
                  typeof renderer !== 'undefined' && typeof pivot !== 'undefined';
      if (ready) {
        hideChrome();
        try {
          loadPayload(payload, true);
          console.log('[Flag Raid] replay viewer booted — ply', (window.CTFReplay || {}).idx,
                      '· pieces', (typeof pieces !== 'undefined' ? pieces.length : '?'),
                      '· boardVisible', (typeof pivot !== 'undefined' ? pivot.visible : '?'));
        } catch (e) { console.error('[Flag Raid replay]', e); }
        // re-hide in case the normal boot revealed a menu asynchronously
        hideChrome();
        setTimeout(hideChrome, 120);
        setTimeout(hideChrome, 500);
        return;
      }
      if (tries++ > 300) return;
      setTimeout(waitReady, 30);
    })();
  }

  /* ===== In-game Review menu wiring ===== */
  function openReviewMenu() {
    ['mainMenu', 'modeMenu', 'botMenu', 'ctfMenu', 'endMenu'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    var rm = document.getElementById('reviewMenu');
    if (rm) rm.style.display = 'flex';
    var ta = document.getElementById('reviewPasteBox'); if (ta) { ta.value = ''; ta.focus(); }
    var st = document.getElementById('reviewLoadStatus'); if (st) st.textContent = '';
  }
  function closeReviewMenu() {
    var rm = document.getElementById('reviewMenu'); if (rm) rm.style.display = 'none';
    var mm = document.getElementById('mainMenu');  if (mm) mm.style.display = 'flex';
  }
  EX.openReviewMenu = openReviewMenu;
  EX.closeReviewMenu = closeReviewMenu;

  function loadFromText(text) {
    var st = document.getElementById('reviewLoadStatus');
    // 1) a full payload (pasted JSON or a dropped exported .html) — exact replay.
    var payload = parseInput(text);
    // 2) otherwise a copied MOVE LIST (FRN or PGN) — reconstruct by re-simulation.
    if (!payload) {
      var plies = parseMoveText(text);
      if (plies && plies.length) {
        try { payload = reconstructFromPlies(plies); }
        catch (e) {
          if (st) st.textContent = '✕ Couldn’t reconstruct moves (' + (e && e.message ? e.message : e) + ').';
          return;
        }
      }
    }
    if (!payload) { if (st) st.textContent = '✕ Could not read a Flag Raid replay or move list from that.'; return; }
    var rm = document.getElementById('reviewMenu'); if (rm) rm.style.display = 'none';
    if (typeof renderer !== 'undefined' && renderer.domElement) renderer.domElement.style.pointerEvents = 'auto';
    loadPayload(payload, false);
  }

  function wireReviewMenu() {
    var loadBtn = document.getElementById('reviewLoadBtn');
    if (loadBtn) loadBtn.onclick = function () {
      if (typeof SND !== 'undefined' && SND.confirm) SND.confirm();
      var ta = document.getElementById('reviewPasteBox');
      loadFromText(ta ? ta.value : '');
    };
    var backBtn = document.getElementById('reviewBackBtn');
    if (backBtn) backBtn.onclick = function () { if (typeof SND !== 'undefined' && SND.ui) SND.ui(); closeReviewMenu(); };

    var fileInput = document.getElementById('reviewFileInput');
    if (fileInput) fileInput.onchange = function () {
      var f = fileInput.files && fileInput.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { loadFromText(r.result); };
      r.readAsText(f);
    };
    // drag & drop a .html / .json file onto the paste box
    var ta = document.getElementById('reviewPasteBox');
    if (ta) {
      ta.addEventListener('dragover', function (e) { e.preventDefault(); });
      ta.addEventListener('drop', function (e) {
        e.preventDefault();
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () { loadFromText(r.result); };
        r.readAsText(f);
      });
    }

    // main-menu entry button
    var openBtn = document.getElementById('mainReviewBtn');
    if (openBtn) openBtn.onclick = function () { if (typeof SND !== 'undefined' && SND.confirm) SND.confirm(); openReviewMenu(); };

    // end-screen one-click download
    var dlBtn = document.getElementById('downloadReplayBtn');
    if (dlBtn) dlBtn.onclick = function () { if (typeof SND !== 'undefined' && SND.ui) SND.ui(); download(); };
  }

  /* ── boot ── */
  function init() {
    wireReviewMenu();
    if (isViewer()) bootViewer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
