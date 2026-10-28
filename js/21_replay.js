/* ============================================================================
   21_replay.js — Flag Raid "Replay Theater"
   ----------------------------------------------------------------------------
   Plays a finished game back as a continuous cinematic animation:
     • each recorded move glides square-to-square (reuses the animations[] tweens)
     • the board turns slowly the whole time
     • EVERY piece is shown — nothing is hidden — but pieces that were sitting in
       the enemy's fog of war on that ply are rendered as faded "phantoms" with a
       cold blue outline, so you can watch what each side could and couldn't see
       as the match unfolded.
     • a caption reads out the move in Flag Raid Notation plus any flag event.

   This is the visual half of the Challenge 3 record-keeping system: the game is
   reconstructed entirely from the recorded `snapshots` / `history` / `moveLog`
   arrays — the exact same data the Copy-record buttons export.
   ============================================================================ */
(function initReplayTheater() {

  var RP = {
    active:   false,
    playing:  false,
    rotate:   true,
    speed:    1,
    idx:      -1,   // ply currently shown (index into history/snapshots)
    pending:  -1,   // ply we are gliding toward
    phase:    'idle', // 'gliding' | 'holding' | 'done'
    phaseT:   0
  };
  window.CTFReplay = RP;

  var GLIDE_MS = 620;  // time the piece spends sliding (queen float is the slowest tween)
  var HOLD_MS  = 280;  // pause on each finished position so the eye can register it
  var FOG_OUTLINE = 0x55b8ff;

  /* ── Fog reconstruction (positions only — independent of live carrier state) ──
     Returns a {"z,x,y":true} set of every square `color` can see, exactly the way
     CTF.computeFog derives sight, but without touching live CTF carrier globals so
     it is safe to run on a rebuilt historical board. */
  function visibleSet(color) {
    var set = Object.create(null);
    pieces.forEach(function(p) {
      if (p.userData.color !== color) return;
      var px = p.userData.x, py = p.userData.y, pz = p.userData.z;
      if (px < 0 || px > 7 || py < 0 || py > 7 || pz < 0 || pz >= LAYERS) return;
      set[pz + ',' + px + ',' + py] = true;
      ctfPieceVision(p).forEach(function(s) {
        if (s.z >= 0 && s.z < LAYERS && s.x >= 0 && s.x < 8 && s.y >= 0 && s.y < 8)
          set[s.z + ',' + s.x + ',' + s.y] = true;
      });
    });
    return set;
  }

  /* Force ALL pieces visible, then flag the ones the opponent could not see. */
  function paintFog() {
    if (!fogOn()) {
      // Standard game: no fog — show every piece solid.
      pieces.forEach(function(p) { p.visible = true; p.userData._phantom = false; setPieceMat(p, { transparent: false, opacity: 1 }); });
      return;
    }
    var sight = { white: visibleSet('white'), black: visibleSet('black') };
    pieces.forEach(function(p) {
      p.visible = true;
      var oppColor = p.userData.color === 'white' ? 'black' : 'white';
      var seen = !!sight[oppColor][p.userData.z + ',' + p.userData.x + ',' + p.userData.y];
      p.userData._phantom = !seen;
      if (seen) {
        setPieceMat(p, { transparent: false, opacity: 1 });
        var base = p.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
        setOutlineColor(p, base.outlineColor);
      } else {
        setPieceMat(p, { transparent: true, opacity: 0.34 });
        setOutlineColor(p, FOG_OUTLINE);
      }
    });
  }

  /* Per-frame phantom shimmer so hidden pieces clearly "phase" in and out. */
  function shimmer(now) {
    var puls = 0.30 + 0.10 * Math.sin(now * 0.005);
    pieces.forEach(function(p) {
      if (p.userData._phantom) setPieceMat(p, { transparent: true, opacity: puls });
    });
  }

  /* ── Caption ── */
  function moveCaption(i) {
    var m = moveLog[i];
    if (!m) return '';
    var sq = function(s) { return String.fromCharCode(97 + s.x) + (s.y + 1) + '·L' + (s.z + 1); };
    var glyph = { P:'♟', N:'♞', B:'♝', R:'♜', Q:'♛', K:'♚' }[m.piece] || '♟';
    var side  = m.moveColor === 'white' ? 'White' : 'Black';
    var txt = (m.number) + '. ' + glyph + ' ' + side + '  ' +
              sq(m.from) + (m.capture ? ' × ' : ' → ') + sq(m.to);
    if (m.flagEvent) txt += '   ' + (m.flagGlyph || '') + ' ' + m.flagEvent;
    return txt;
  }

  /* ── DOM (built once, lazily) ── */
  var bar, captionEl, progEl, playBtn, speedBtn, scrubEl, closeBtn, legendEl;
  /* Fog-of-war phantom rendering only applies to Capture-the-Flag games that
     expose the per-piece vision helper; a standard game just shows everything. */
  function fogOn() { return typeof ctfMode !== 'undefined' && ctfMode && typeof ctfPieceVision === 'function'; }
  function buildBar() {
    if (bar) return;
    bar = document.createElement('div');
    bar.id = 'replayBar';
    bar.style.cssText =
      'position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);' +
      'z-index:70;display:none;flex-direction:column;align-items:center;gap:6px;' +
      'background:rgba(8,5,2,0.92);border:1px solid #3a2a16;border-radius:8px;' +
      'padding:10px 14px;font-family:monospace;color:#d8c4a0;min-width:280px;max-width:92vw;' +
      'box-shadow:0 6px 26px rgba(0,0,0,0.6);backdrop-filter:blur(3px);';

    captionEl = document.createElement('div');
    captionEl.style.cssText = 'font-size:12px;letter-spacing:0.5px;text-align:center;min-height:16px;color:#f0dcb0;';

    var legend = document.createElement('div');
    legendEl = legend;
    legend.style.cssText = 'font-size:9px;letter-spacing:0.5px;color:#8a7250;text-align:center;';
    legend.innerHTML = 'SOLID = seen by the enemy &nbsp;·&nbsp; ' +
      '<span style="color:#55b8ff;">FADED</span> = hidden in fog of war';

    /* Scrub slider — drag to any ply (full review-bar control). */
    scrubEl = document.createElement('input');
    scrubEl.type = 'range';
    scrubEl.min = '-1'; scrubEl.step = '1';
    scrubEl.style.cssText = 'width:100%;accent-color:#c8902a;cursor:pointer;margin:2px 0;touch-action:manipulation;';
    scrubEl.oninput = function() { goto(parseInt(scrubEl.value, 10)); };

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:2px;';

    function mk(label, title) {
      var b = document.createElement('button');
      b.textContent = label; b.title = title || '';
      b.style.cssText = 'background:#15100a;border:1px solid #3a2a16;color:#cbb58a;cursor:pointer;' +
        'font-family:monospace;font-size:13px;padding:5px 9px;border-radius:4px;line-height:1;touch-action:manipulation;';
      row.appendChild(b); return b;
    }
    var firstBtn = mk('⏮', 'Restart');
    var stepBack = mk('◂', 'Step back one move');
    playBtn      = mk('⏸', 'Play / Pause');
    var stepFwd  = mk('▸', 'Step forward one move');
    var lastBtn  = mk('⏭', 'Jump to end');
    speedBtn     = mk('1×', 'Cycle speed');
    var rotBtn   = mk('⟳', 'Toggle board spin');
    var saveBtn  = mk('⬇', 'Save this replay as a portable .html file');
    closeBtn     = mk('✕', 'Close replay');

    progEl = document.createElement('div');
    progEl.style.cssText = 'font-size:10px;color:#8a7250;margin-left:6px;min-width:64px;text-align:right;';
    row.appendChild(progEl);

    bar.appendChild(captionEl); bar.appendChild(legend); bar.appendChild(scrubEl); bar.appendChild(row);
    document.body.appendChild(bar);

    firstBtn.onclick = function() { snd(); restart(); };
    stepBack.onclick = function() { snd(); step(-1); };
    playBtn.onclick  = function() { snd(); RP.playing = !RP.playing; playBtn.textContent = RP.playing ? '⏸' : '▶'; if (RP.playing && RP.idx >= history.length - 1) restart(); else if (RP.playing) { RP.phase = 'holding'; RP.phaseT = performance.now(); } };
    stepFwd.onclick  = function() { snd(); step(1); };
    lastBtn.onclick  = function() { snd(); jumpToEnd(); };
    speedBtn.onclick = function() { snd(); cycleSpeed(); };
    rotBtn.onclick   = function() { snd(); RP.rotate = !RP.rotate; rotBtn.style.color = RP.rotate ? '#cbb58a' : '#5a4a30'; };
    saveBtn.onclick  = function() { snd(); if (window.CTFExport && window.CTFExport.download) window.CTFExport.download(); };
    closeBtn.onclick = function() { snd(); stop(); };
  }

  function snd() { if (typeof SND !== 'undefined' && SND.ui) SND.ui(); }

  function cycleSpeed() {
    var steps = [0.5, 1, 2, 3];
    var i = steps.indexOf(RP.speed);
    RP.speed = steps[(i + 1) % steps.length];
    speedBtn.textContent = RP.speed + '×';
  }

  function progress() {
    if (progEl) progEl.textContent = (RP.idx + 1) + ' / ' + history.length;
    if (scrubEl) {
      scrubEl.max = String(history.length - 1);
      if (document.activeElement !== scrubEl) scrubEl.value = String(RP.idx);
    }
  }

  /* Jump straight to ply `i` (no glide) — used by the scrub slider / step buttons. */
  function goto(i) {
    i = Math.max(-1, Math.min(history.length - 1, i));
    animations.length = 0;
    RP.playing = false;
    if (playBtn) playBtn.textContent = '▶';
    if (i < 0) {
      showStart();
    } else {
      loadHistory(i);
      RP.idx = i; RP.pending = i;
      paintFog();
      if (captionEl) captionEl.textContent = moveCaption(i);
      progress();
    }
    RP.phase = 'holding';
    RP.phaseT = performance.now();
  }
  function step(d) { goto(RP.idx + d); }

  /* ── Step machinery ── */
  function beginGlide(i) {
    RP.pending = i;
    var mv = history[i];
    var mover = mv ? occ(mv.from.x, mv.from.y, mv.from.z) : null;
    if (mover && typeof animateMove === 'function') {
      animateMove(mover, mv.from, mv.to);
    }
    RP.phase = 'gliding';
    RP.phaseT = performance.now();
  }

  function finalizeStep() {
    var i = RP.pending;
    animations.length = 0;            // drop any in-flight tween; loadHistory is truth
    loadHistory(i);                   // rebuild exact board (captures / promotions / respawns)
    RP.idx = i;
    paintFog();
    if (captionEl) captionEl.textContent = moveCaption(i);
    progress();
    RP.phase = 'holding';
    RP.phaseT = performance.now();
  }

  function advance() {
    var next = RP.idx + 1;
    if (next >= history.length) { RP.playing = false; RP.phase = 'done'; if (playBtn) playBtn.textContent = '▶'; return; }
    beginGlide(next);
  }

  /* Reset to the opening position (rebuilt from scratch, kings stripped as in CTF). */
  function showStart() {
    animations.length = 0;
    resetBoard(false);                       // re-lays the starting army, keeps the record
    window._ctfReviewUnlocked = true;        // resetBoard re-locks review — undo that for replay
    if (typeof reviewing !== 'undefined') reviewing = true; // block stray board taps during playback
    if (fogOn()) {  // CTF has no kings — strip them from the opening frame; standard chess keeps them
      pieces.filter(function(p) { return p.userData.type === 'king'; })
            .forEach(function(k) { if (k.parent) k.parent.remove(k); pieces.splice(pieces.indexOf(k), 1); });
    }
    if (typeof update === 'function') update();
    paintFog();
    if (captionEl) captionEl.textContent = 'Opening position';
    RP.idx = -1; RP.pending = -1;
    progress();
  }

  function restart() {
    showStart();
    RP.playing = true;
    if (playBtn) playBtn.textContent = '⏸';
    RP.phase = 'holding';
    RP.phaseT = performance.now();
  }

  function jumpToEnd() {
    animations.length = 0;
    var last = history.length - 1;
    if (last < 0) return;
    loadHistory(last);
    RP.idx = last; RP.pending = last;
    paintFog();
    if (captionEl) captionEl.textContent = moveCaption(last);
    progress();
    RP.playing = false; RP.phase = 'done';
    if (playBtn) playBtn.textContent = '▶';
  }

  function tick() {
    if (!RP.active) return;
    requestAnimationFrame(tick);
    var now = performance.now();
    if (RP.rotate && typeof pivot !== 'undefined') pivot.rotation.y += 0.0035;
    shimmer(now);
    if (!RP.playing) return;
    var dt = now - RP.phaseT;
    if (RP.phase === 'gliding' && dt >= GLIDE_MS / RP.speed) {
      finalizeStep();
    } else if (RP.phase === 'holding' && dt >= HOLD_MS / RP.speed) {
      advance();
    }
  }

  /* ── Public entry / exit ── */
  function start() {
    if (!history || history.length === 0) return;
    buildBar();
    if (legendEl) legendEl.style.display = fogOn() ? 'block' : 'none';  // fog legend is CTF-only
    RP.active = true;
    if (typeof setReviewing === 'function') setReviewing(true);
    var rc = document.getElementById('reviewControls'); if (rc) rc.style.display = 'none';
    var mn = document.getElementById('moveNumBar');     if (mn) mn.style.display = 'none';
    bar.style.display = 'flex';
    // In standalone viewer mode (the exported .html file) there is no end-menu to
    // return to, so hide the ✕ — the file IS the replay.
    if (closeBtn) closeBtn.style.display = RP._standalone ? 'none' : '';
    RP.speed = 1; if (speedBtn) speedBtn.textContent = '1×';
    requestAnimationFrame(tick);
    restart();
  }
  function stop() {
    RP.active = false;
    RP.playing = false;
    animations.length = 0;
    if (bar) bar.style.display = 'none';
    // Leave the board on the final position with normal materials, hand control
    // back to the end-game menu the player came from.
    jumpToEnd();
    pieces.forEach(function(p) {
      p.userData._phantom = false;
      p.visible = true;
      setPieceMat(p, { transparent: false, opacity: 1 });
      var base = p.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
      setOutlineColor(p, base.outlineColor);
    });
    if (typeof setReviewing === 'function') setReviewing(false);
    var mn = document.getElementById('moveNumBar'); if (mn) mn.style.display = 'none';
    if (RP._standalone) return;   // exported file: nothing to return to
    // Launched from the in-game Review menu (not a finished match) → run the
    // caller's close handler instead of revealing the end-of-game menu.
    if (typeof RP._onClose === 'function') { var cb = RP._onClose; RP._onClose = null; cb(); return; }
    var em = document.getElementById('endMenu');     if (em) em.style.display = 'flex';
  }

  RP.start   = start;
  RP.stop    = stop;
  RP.restart = restart;
  RP.goto    = goto;      // jump to a ply (scrub) — used by the combined review bar
  RP.step    = step;
  RP.jumpToEnd = jumpToEnd;

  /* Wire the end-menu launch button once the DOM is ready. */
  function wireButton() {
    var b = document.getElementById('cinematicReplayBtn');
    if (!b) return;
    b.onclick = function() {
      snd();
      var em = document.getElementById('endMenu'); if (em) em.style.display = 'none';
      if (typeof renderer !== 'undefined' && renderer.domElement) renderer.domElement.style.pointerEvents = 'auto';
      start();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireButton);
  else wireButton();

})();
