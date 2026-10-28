/* ==========================================================================
   AURORA CHESS — COZY SCENE  (3D presentation layer)
   --------------------------------------------------------------------------
   Softens how the existing scene LOOKS. It does not change what the scene IS:
   the board is still four volumetric 8×8 layers, the pieces are still the same
   GLB/lathe geometry at the same coordinates, and every raycast target
   (layerPlanes) is left exactly as the game built it.

   Three jobs:
     1. czApplyBoardPalette(name) — retint the cosmic-glass slabs to pastel
        glass and give them rounded corners
     2. a 'cozy' piece material preset — matte, semi-gloss, softly lit
     3. soft-edged move/selection highlights instead of hard flat squares

   Everything hooks the existing globals by wrapping them. In a classic-script
   page a top-level `function foo(){}` is `window.foo`, so reassigning it
   re-points every later call site — which is how 17_themes.js already layers
   its own behaviour onto update() and executeMove().
   ========================================================================== */
(function () {
  'use strict';

  if (typeof THREE === 'undefined') return;

  /* ======================================================================
     PALETTES
     Sampled from the supplied background artwork so the board sits IN the
     scene rather than floating on top of it.
     ====================================================================== */
  var CZ_PALETTES = {
    aurora: {
      slab:      0x74c2dc,   // tinted cyan glass — light enough to glow, dark
      slabEmis:  0x16283f,   // enough not to wash out to white when stacked
      slabEmisAct: 0x244a63,
      base:      0x93abcb,   // the solid bottom board: soft periwinkle. Tuned so it
                             // RENDERS as ~#8fabdc under the lights above —
                             // see the readPixels loop in the session notes.
      baseEmis:  0x0d1428,
      edge:      0xcfeef6,
      grid:      0xbfe4f0,
      white:     { color: 0xf6f1e6, outline: 0xcfc0a4, sel: 0xffe9b0 },  // warm ivory
      black:     { color: 0x6b5fa8, outline: 0x342c60, sel: 0xd7b4ff },  // muted lavender
      square:    { light: '#7f8fd0', dark: '#5a63a8' }
    },
    midnight: {
      slab:      0x7480cc,
      slabEmis:  0x191740,
      slabEmisAct: 0x2c2a63,
      base:      0x8189d6,
      baseEmis:  0x1d1b4a,
      edge:      0xd6d8f8,
      grid:      0xc3c6f0,
      white:     { color: 0xf4efe4, outline: 0xcabfa6, sel: 0xffe4b8 },
      black:     { color: 0x5d55a0, outline: 0x2b2658, sel: 0xc9aef5 },
      square:    { light: '#6f76c4', dark: '#4b5091' }
    },
    jade: {
      slab:      0x74c8a6,
      slabEmis:  0x102b22,
      slabEmisAct: 0x1f5040,
      base:      0x7cc0a0,
      baseEmis:  0x143026,
      edge:      0xd2f5e4,
      grid:      0xbdedd8,
      white:     { color: 0xf6f2e4, outline: 0xccc3a4, sel: 0xffeeb4 },
      black:     { color: 0x3f7a63, outline: 0x1e3d32, sel: 0xa8e8c6 },
      square:    { light: '#6aa88a', dark: '#437060' }
    }
  };

  var _czPalette = null;       // the active palette object, or null
  var _czPaletteName = null;   // its key, so a rebuild can re-apply the same one

  /* ======================================================================
     1. BOARD — pastel glass slabs with rounded corners
     ====================================================================== */

  /* A flat slab with rounded corners: a 2D rounded rectangle extruded and
     laid down. Replaces the BoxGeometry the original builds.

     ALIGNMENT — the one subtle thing here. 11_camera.js:333 hardcodes
     `s.slab.position.y = -(0.35/2) + float` every frame, so the mesh origin is
     pinned to -0.175 no matter how thick we make the slab. Rather than edit the
     camera module, this bakes the alignment into the geometry: the top face is
     placed at exactly +0.175 in geometry space, so the mesh lands it flush with
     the square planes at y=0 and any extra thickness grows DOWNWARD — which is
     also what the reference art wants, a board with visible depth under the
     play surface.

     (The previous version translated by +thickness/2, which is what you'd do to
     centre a shape spanning [-t/2, t/2]. But rotateX(-90°) maps the extrusion's
     z∈[0,depth] onto y∈[0,depth] — it is already sitting on the origin, not
     centred on it — so that pushed every slab a full thickness too high and
     floated the glass up through the pieces.) */
  var SLAB_TOP_Y = 0.35 / 2;    // must match the constant in 11_camera.js

  function makeRoundedSlabGeometry(size, thickness, radius) {
    var h = size / 2;
    var shape = new THREE.Shape();
    shape.moveTo(-h + radius, -h);
    shape.lineTo(h - radius, -h);
    shape.quadraticCurveTo(h, -h, h, -h + radius);
    shape.lineTo(h, h - radius);
    shape.quadraticCurveTo(h, h, h - radius, h);
    shape.lineTo(-h + radius, h);
    shape.quadraticCurveTo(-h, h, -h, h - radius);
    shape.lineTo(-h, -h + radius);
    shape.quadraticCurveTo(-h, -h, -h + radius, -h);

    // A soft, evenly-rounded lip rather than a sharp chamfer — the reference
    // slabs read as moulded plastic, so the bevel is capped in absolute units
    // instead of scaling with thickness (a thick base slab with a proportional
    // bevel turns into a pillow).
    var bevel = Math.min(thickness * 0.3, 0.05);
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.001, thickness - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 12
    });
    // Extrude builds along +Z; lay it flat, then align by measured bounds so
    // the top face is flush regardless of how the bevel grew the solid.
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    geo.translate(0, SLAB_TOP_Y - geo.boundingBox.max.y, 0);
    geo.computeVertexNormals();
    return geo;
  }

  /* The matching rounded outline for the slab's top edge. */
  function makeRoundedEdgePoints(size, radius, segments) {
    var h = size / 2, pts = [], i;
    var corners = [
      { cx:  h - radius, cz:  h - radius, a0: 0 },
      { cx: -h + radius, cz:  h - radius, a0: Math.PI / 2 },
      { cx: -h + radius, cz: -h + radius, a0: Math.PI },
      { cx:  h - radius, cz: -h + radius, a0: Math.PI * 1.5 }
    ];
    corners.forEach(function (c) {
      for (i = 0; i <= segments; i++) {
        var a = c.a0 + (i / segments) * (Math.PI / 2);
        pts.push(new THREE.Vector3(c.cx + Math.cos(a) * radius, 0,
                                   c.cz + Math.sin(a) * radius));
      }
    });
    return pts;
  }

  /* Which slab is the solid base? The reference gives the LOWEST board real
     physical depth and leaves the ones above it as thin floating sheets. Find
     it by world height rather than assuming index 0, so this survives any
     re-ordering of `layers`. */
  function baseSlabIndex() {
    var lowest = 0, lowY = Infinity;
    _cgSlabs.forEach(function (s, i) {
      var y = s.slab.parent ? s.slab.parent.position.y : 0;
      if (y < lowY) { lowY = y; lowest = i; }
    });
    return lowest;
  }

  var BASE_THICK  = 0.62;   // the chunky bottom board
  // Every layer is the same slab thickness now — the sheets used to be 0.16 and
  // read as flimsy next to the base. Safe against the Layer Gap slider: its
  // minimum is 1.2 (index.html slider min="12"), and thickness grows DOWNWARD
  // from each top face, so 0.62 never reaches the slab below.
  var SHEET_THICK = BASE_THICK;
  var _czBaseIdx  = -1;     // which slab got the base treatment

  var _czSlabsRounded = false;

  function roundSlabCorners() {
    if (_czSlabsRounded) return;
    if (typeof _cgSlabs === 'undefined' || !_cgSlabs.length) return;

    var boardSize = BOARD * SPACING;
    var radius    = SPACING * 0.55;       // a little over half a square

    _czBaseIdx = baseSlabIndex();

    // Two geometries, shared by the slabs that use them.
    var sheetGeo = makeRoundedSlabGeometry(boardSize, SHEET_THICK, radius);
    var baseGeo  = makeRoundedSlabGeometry(boardSize, BASE_THICK,  radius);
    var edgePts  = makeRoundedEdgePoints(boardSize, radius, 6);

    _cgSlabs.forEach(function (s, i) {
      var geo = (i === _czBaseIdx) ? baseGeo : sheetGeo;
      var old = s.slab.geometry;
      s.slab.geometry = geo;
      if (old && old.dispose && old !== geo) old.dispose();

      // The base board is a solid object: it must occlude and be lit like one.
      // The sheets stay depth-write-free so they composite cleanly over each
      // other and over the artwork.
      if (i === _czBaseIdx) {
        s.slab.material.depthWrite = true;
        s.slab.material.side       = THREE.FrontSide;
        s.slab.material.shininess  = 6;      // matte moulded plastic, not glass
        s.slab.renderOrder         = -1;
      }

      var oldEdge = s.edge.geometry;
      s.edge.geometry = new THREE.BufferGeometry().setFromPoints(edgePts);
      if (oldEdge && oldEdge.dispose) oldEdge.dispose();
    });
    _czSlabsRounded = true;
  }

  /* _updateCgSlabActivity() runs on every update() and hardcodes 0x00eeff, so
     retinting the slabs once would be undone on the next layer change. Wrap it
     instead: let the original set the opacities (which the settings sliders
     drive), then repaint the colours from the active palette. */
  function hookSlabActivity() {
    if (typeof _updateCgSlabActivity !== 'function') return;
    var _orig = _updateCgSlabActivity;
    _updateCgSlabActivity = function () {
      _orig.apply(this, arguments);
      if (!_czPalette || typeof _cgSlabs === 'undefined') return;
      var P = _czPalette;
      _cgSlabs.forEach(function (s, i) {
        var isAct = (i === activeZ);

        if (i === _czBaseIdx) {
          // The solid bottom board. It is the one surface in the scene that is
          // NOT glass, so it ignores the activity opacity entirely — a base
          // board that fades when you switch layers stops reading as an object.
          s.slab.material.color.setHex(P.base || P.slab);
          s.slab.material.emissive.setHex(P.baseEmis || P.slabEmis);
          s.slab.material.opacity = 1;
        } else {
          s.slab.material.color.setHex(P.slab);
          s.slab.material.emissive.setHex(isAct ? P.slabEmisAct : P.slabEmis);
          // The neon look wanted near-invisible sheets (0.25 active / 0.08 dim),
          // which at the reference's viewing angle is close to nothing — the
          // upper boards have to read as frosted PANES you could stack coasters
          // on. Multiply the user's slider value as before but hold a floor, so
          // the slider still opens the glass up and can no longer close it past
          // the point where the stack stops looking like a stack.
          // Floors, not fixed values, so the settings slider still opens the
          // glass up. The dim floor is deliberately low: THREE sheets stack
          // over the base board, and their opacities compound — 0.24 each
          // washed the whole middle of the board out to near-white.
          s.slab.material.opacity = Math.min(0.9, Math.max(
            s.slab.material.opacity * (isAct ? 1.05 : 1.7),
            isAct ? 0.30 : 0.14));
        }

        s.edge.material.color.setHex(P.edge);
        s.edge.material.opacity = isAct ? 0.50 : 0.24;
        s.grid.material.color.setHex(P.grid);
        s.grid.material.opacity = isAct ? 0.26 : 0.11;
      });
    };
    window._updateCgSlabActivity = _updateCgSlabActivity;
  }

  /* ======================================================================
     2. PIECES — the 'cozy' material preset
     ====================================================================== */

  function hookPieceMaterial() {
    if (typeof buildPieceMaterial !== 'function') return;
    var _orig = buildPieceMaterial;
    buildPieceMaterial = function (cfg, isOutline) {
      if (isOutline || !cfg || cfg.materialPreset !== 'cozy') {
        return _orig.apply(this, arguments);
      }
      // Matte with a soft sheen — a painted wooden toy under moonlight, not
      // glass and not metal. Opaque, so pieces read solidly against the
      // translucent slabs behind them.
      var mat = new THREE.MeshPhysicalMaterial({
        color:     cfg.color !== undefined ? cfg.color : 0xf6f1e6,
        roughness: 0.62,
        metalness: 0.0,
        clearcoat: 0.28,             // the faint semi-gloss highlight
        clearcoatRoughness: 0.55,
        emissive:  new THREE.Color(cfg.emissiveColor !== undefined ? cfg.emissiveColor : 0x2a2450),
        emissiveIntensity: cfg.emissiveIntensity !== undefined ? cfg.emissiveIntensity : 0.13,
        transparent: false,
        opacity: 1
      });
      // Sheen fakes the soft fall-off of a matte surface at grazing angles —
      // the single cheapest thing that makes a piece look plush.
      //
      // The API changed shape in three.js r132: before it, `sheen` IS the
      // tint Color; after it, `sheen` is a 0–1 float and the tint moved to
      // `sheenColor`. Assigning the float form to r128 hands a Number to
      // uniform3fv and throws on the FIRST render, blanking the whole board —
      // so branch on which API is actually present rather than on a version
      // number. (This page ships r128.)
      if (!IS_MOBILE) {
        try {
          if ('sheenColor' in mat) {          // r132+
            mat.sheen = 0.55;
            mat.sheenColor = new THREE.Color(0xbfd8ff);
            mat.sheenRoughness = 0.7;
          } else {                            // r128: sheen is the Color itself
            mat.sheen = new THREE.Color(0x6f86b8);
          }
        } catch (e) { /* older three.js — the base material is still fine */ }
      }
      return mat;
    };
    window.buildPieceMaterial = buildPieceMaterial;
  }

  /* The per-piece additive glow sprite (04_board.js _addGlow) is tuned for the
     neon look: a bright blue/amber halo at 0.18 that turns matte pieces into
     glowing blobs. Cozy wants a faint ambient lift instead, so the piece reads
     as lit by the aurora rather than as a light source.

     applyPieceAppearance() re-tints these sprites every time it runs, so this
     has to be called AFTER it, not before. */
  /* The per-frame halo animation in 11_camera.js re-derives sprite opacity from
     its own constants every tick, so the colour/scale below stick but opacity
     does not — it has to be dialled down at the source. Reference pieces are
     matte painted toys; they catch light, they do not emit it. */
  window.CZ_GLOW = { on: 0.085, off: 0.045, pulse: 0.03 };

  function softenPieceGlow() {
    if (typeof pieces === 'undefined') return;
    pieces.forEach(function (p) {
      var isWhite = p.userData.color === 'white';
      p.traverse(function (obj) {
        if (!obj.userData || !obj.material) return;

        if (obj.userData.isGlow && !obj.userData.isGlowHL) {
          obj.material.color.setHex(isWhite ? 0xbfd0f0 : 0x9f8fd8);
          obj.material.opacity = 0.07;
          obj.scale.set(0.95, 0.95, 1.0);
          return;
        }

        /* The 'glow' HIGHLIGHT sprite (05_pieces.js:151) — one per piece, an
           additive #00ccff disc at 0.38. This used to be skipped, which left
           sixteen neon halos blazing over the pastel board: by far the loudest
           thing on screen and pure leftover from the old theme. It is decor,
           not a selection cue (every piece gets one), so it becomes a faint
           pastel lift. Nothing animates it per frame, so setting it once holds
           until the pieces are rebuilt — which re-runs this via hookPieceGlow. */
        if (obj.userData.isGlowHL) {
          var P = _czPalette;
          obj.material.color.setHex(
            P ? (isWhite ? P.white.outline : P.black.sel) : 0xbfd0f0);
          obj.material.opacity = 0.10;
          obj.scale.set(1.2, 1.2, 1.0);
        }
      });
    });
  }

  /* Pieces are rebuilt from scratch on every resetBoard() → placeStartingPieces(),
     and each new piece gets a fresh 0.18 halo from _addGlow(). Softening once at
     boot therefore lasts exactly until the first game starts. Re-run after both
     of the calls that can (re)create or repaint pieces. */
  function hookPieceGlow() {
    ['applyPieceAppearance', 'placeStartingPieces'].forEach(function (name) {
      if (typeof window[name] !== 'function') return;
      var _orig = window[name];
      window[name] = function () {
        var r = _orig.apply(this, arguments);
        if (_czPalette) softenPieceGlow();
        return r;
      };
    });
  }

  /* Warmer, softer scene lighting to match. The originals are hard white
     spots; these are a moonlit key with a lavender bounce. */
  /* These four intensities used to total 2.06, which drove every mid-tone past
     1.0: the base board measured #cdffff at the framebuffer — green and blue
     hard-clipped — so the pastel palette was being thrown away by the lighting
     before it ever reached the screen. Clipped channels also flatten shading,
     which is why the pieces read as washed-out blobs rather than the soft matte
     forms in the reference. Total is now ~1.47, leaving headroom for the
     palette to actually show. */
  function softenLights() {
    try {
      if (typeof _sceneAmbient !== 'undefined') {
        _sceneAmbient.color.setHex(0xcfd8ff); _sceneAmbient.intensity = 0.42;
      }
      if (typeof _sceneKey !== 'undefined') {
        _sceneKey.color.setHex(0xfff2e0); _sceneKey.intensity = 0.55;
      }
      if (typeof _sceneFill !== 'undefined') {
        _sceneFill.color.setHex(0x9fb8ff); _sceneFill.intensity = 0.28;
      }
      if (typeof _sceneRim !== 'undefined') {
        _sceneRim.color.setHex(0xa88fd8); _sceneRim.intensity = 0.22;
      }
    } catch (e) { /* lighting is decoration — never fatal */ }
  }

  /* ======================================================================
     3. HIGHLIGHTS — soft glowing dots and gentle rings
     ====================================================================== */

  /* A radial-gradient sprite texture: opaque core fading to nothing, so a
     legal-move marker reads as a soft dot of light on the square rather than
     a hard translucent tile. */
  function makeSoftDotTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0.00, 'rgba(255,255,255,1)');
    grd.addColorStop(0.28, 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.46, 'rgba(255,255,255,0.34)');
    grd.addColorStop(0.72, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  /* A rounded-square wash with a soft ring just inside the edge — used for
     the selected square and the last move, where the whole square should read
     as lit rather than a single dot. */
  function makeSoftTileTexture() {
    var S = 128, r = 26;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');

    function roundRect(x, y, w, h, rad) {
      g.beginPath();
      g.moveTo(x + rad, y);
      g.arcTo(x + w, y,     x + w, y + h, rad);
      g.arcTo(x + w, y + h, x,     y + h, rad);
      g.arcTo(x,     y + h, x,     y,     rad);
      g.arcTo(x,     y,     x + w, y,     rad);
      g.closePath();
    }

    // Soft interior fill
    g.fillStyle = 'rgba(255,255,255,0.36)';
    roundRect(8, 8, S - 16, S - 16, r); g.fill();
    // Gentle ring, blurred outward by drawing it as a wide feathered stroke
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 5;
    g.shadowColor = 'rgba(255,255,255,0.9)';
    g.shadowBlur = 12;
    roundRect(10, 10, S - 20, S - 20, r); g.stroke();
    return new THREE.CanvasTexture(c);
  }

  var _softDot = null, _softTile = null;

  /* Wrap square(): keep every position, opacity, userData and bookkeeping the
     original sets — only swap in the soft texture. */
  function hookSquareHighlights() {
    if (typeof square !== 'function') return;
    var _orig = square;
    square = function (x, y, z, strong, colorHex, opacityVal) {
      var m = _orig.apply(this, arguments);
      try {
        if (!_softDot)  _softDot  = makeSoftDotTexture();
        if (!_softTile) _softTile = makeSoftTileTexture();
        m.material.map = strong ? _softTile : _softDot;
        m.material.needsUpdate = true;
        // The soft textures are mostly transparent, so the same numeric
        // opacity reads much fainter than a flat fill did. Compensate, and
        // keep userData.baseOpacity in step — the per-frame pulse in
        // 11_camera.js reads it.
        var boost = strong ? 1.15 : 1.55;
        m.material.opacity = Math.min(1, m.material.opacity * boost);
        m.userData.baseOpacity = Math.min(1, m.userData.baseOpacity * boost);
      } catch (e) { /* fall back to the original flat plate */ }
      return m;
    };
    window.square = square;
  }

  /* ======================================================================
     PUBLIC ENTRY POINT — called by js/24_cozy_ui.js's theme carousel
     ====================================================================== */

  function czApplyBoardPalette(name) {
    var P = CZ_PALETTES[name];
    if (!P) return;
    _czPalette = P;
    _czPaletteName = name;

    roundSlabCorners();

    // Board squares. Under cosmic glass these planes are transparent (they
    // only exist for raycasting) but the theme still has to be right for when
    // the user turns cosmic glass off.
    if (typeof rebuildSquareTextures === 'function') {
      try { rebuildSquareTextures(P.square.light, P.square.dark); } catch (e) {}
    }

    // Pieces: warm ivory vs muted lavender, both on the cozy material.
    try {
      CFG.pieces.white.color            = P.white.color;
      CFG.pieces.white.outlineColor     = P.white.outline;
      CFG.pieces.white.outlineSelColor  = P.white.sel;
      CFG.pieces.white.materialPreset   = 'cozy';
      CFG.pieces.white.baseOpacity      = 1.0;
      CFG.pieces.white.emissiveColor    = 0x2a2450;
      CFG.pieces.white.emissiveIntensity= 0.10;
      CFG.pieces.white.highlightColor   = P.white.outline;  // never neon cyan
      CFG.pieces.white.thickness        = 0.022;   // thinner, softer contour

      CFG.pieces.black.color            = P.black.color;
      CFG.pieces.black.outlineColor     = P.black.outline;
      CFG.pieces.black.outlineSelColor  = P.black.sel;
      CFG.pieces.black.materialPreset   = 'cozy';
      CFG.pieces.black.baseOpacity      = 1.0;
      CFG.pieces.black.emissiveColor    = 0x1d1740;
      CFG.pieces.black.emissiveIntensity= 0.12;
      CFG.pieces.black.highlightColor   = P.black.sel;
      CFG.pieces.black.thickness        = 0.022;

      if (typeof applyPieceAppearance === 'function') applyPieceAppearance();
      softenPieceGlow();
    } catch (e) { console.warn('[cozy-scene] piece palette:', e); }

    // Highlights: pastel, low-contrast, never neon.
    try {
      CFG.hl.legal.color     = 0xbfeee0;  CFG.hl.legal.opacity     = 0.42;
      CFG.hl.selection.color = 0xfff0c8;  CFG.hl.selection.opacity = 0.62;
      CFG.hl.lastMove.color  = 0xa9b8ee;  CFG.hl.lastMove.opacity  = 0.40;
      CFG.hl.threats.color   = 0xe8b4c8;  CFG.hl.threats.opacity   = 0.38;
      if (typeof refreshLegalMoveHighlights === 'function') refreshLegalMoveHighlights();
      if (typeof refreshLastMove === 'function')            refreshLastMove();
      if (typeof refreshThreatHighlights === 'function')    refreshThreatHighlights();
    } catch (e) {}

    if (typeof _updateCgSlabActivity === 'function' &&
        typeof cosmicGlassActive !== 'undefined' && cosmicGlassActive) {
      _updateCgSlabActivity();
    }
    if (typeof update === 'function') update();
  }

  window.czApplyBoardPalette = czApplyBoardPalette;

  /* Cosmic glass can be torn down and rebuilt at runtime — the settings chips
     and the welcome wizard's presets both do it. _buildCgSlabs() then hands us
     brand-new BoxGeometry meshes, while `_czSlabsRounded` is still latched true
     from the first run, so the rounded pastel slabs would silently never come
     back: the board would quietly revert to sharp cyan sheets with no error
     anywhere. Re-assert the whole cozy treatment every time the glass is
     (re)built. */
  function hookGlassRebuild() {
    if (typeof applyCosmicGlassTheme !== 'function') return;
    var _orig = applyCosmicGlassTheme;
    window.applyCosmicGlassTheme = function () {
      var r = _orig.apply(this, arguments);
      _czSlabsRounded = false;
      if (_czPaletteName) czApplyBoardPalette(_czPaletteName);
      return r;
    };
  }

  /* ======================================================================
     TILE THREAT SCAN (TTS) OVERRIDE
     ----------------------------------------------------------------------
     The TTS overlay is built in index.html, and it is the one board highlight
     the redesign never reached: hookSquareHighlights() above swaps in a
     rounded soft texture for everything that goes through square(), but TTS
     rolls its own MeshBasicMaterial + PlaneGeometry with no map. The result is
     a hard-edged saturated square sitting on top of rounded pastel tiles —
     it overhangs the tile art beneath it and reads as a different game.

     This is an override table, not a rewrite: index.html consults window.CZ_TV
     if it exists and otherwise builds the original flat neon plates unchanged,
     the same arrangement CZ_GLOW and CZ_BG_ACTIVE already use.
     ====================================================================== */

  /* A rounded tile that is SOLID in the middle and feathers out before the
     corner, so the plate always stops inside the rounded square below it.
     Distinct from makeSoftTileTexture(): that one is a wash with a bright ring
     for the selected square, where the ring is the point. A threat plate wants
     to read as a filled tile, so the ring would fight the fill. */
  function makeThreatTileTexture() {
    var S = 128, r = 30, pad = 9;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');

    function roundRect(x, y, w, h, rad) {
      g.beginPath();
      g.moveTo(x + rad, y);
      g.arcTo(x + w, y,     x + w, y + h, rad);
      g.arcTo(x + w, y + h, x,     y + h, rad);
      g.arcTo(x,     y + h, x,     y,     rad);
      g.arcTo(x,     y,     x + w, y,     rad);
      g.closePath();
    }

    // Feathered outer edge first — a blurred copy of the same rounded shape,
    // drawn underneath, is what keeps the plate from ending on a hard line.
    g.save();
    g.shadowColor = 'rgba(255,255,255,0.55)';
    g.shadowBlur = 10;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(pad + 2, pad + 2, S - (pad + 2) * 2, S - (pad + 2) * 2, r); g.fill();
    g.restore();

    // Solid core
    g.fillStyle = 'rgba(255,255,255,0.96)';
    roundRect(pad, pad, S - pad * 2, S - pad * 2, r); g.fill();
    return new THREE.CanvasTexture(c);
  }

  var _tvTex = null;

  window.CZ_TV = {
    tileTexture: function () {
      if (!_tvTex) _tvTex = makeThreatTileTexture();
      return _tvTex;
    },
    /* Keyed by the neon constant index.html would otherwise have used, so the
       mapping is readable next to the call site it replaces.

       Own-side coverage goes to MINT rather than to the palette's blue: the
       board is periwinkle, so a pastel blue plate on it is a tint of the same
       hue at the same value and simply disappears. Rose against mint also
       keeps the two overlays telling each other apart at a glance, which is
       the whole point of showing them together. */
    colors: {
      0xff2200: 0xf5919f,   /* enemy threat   → --cz-rose   */
      0xff8800: 0xf2d08a,   /* inspected tile → --cz-gold   */
      0x0088ff: 0x9fe0d2    /* own coverage   → --cz-mint   */
    },
    /* The texture is transparent at the edges, so the same numeric opacity
       reads fainter than the old flat fill did — the same compensation
       hookSquareHighlights() makes, for the same reason. */
    opacityBoost: 1.22
  };

  /* Board arrows — the move arrow drawn on review and the check-threat arrow.
     Both were hardcoded neon (0xff8800 / 0xff2200) picked to read against the
     old cyan grid; on the pastel board they are the loudest thing on screen.
     Mapped to the same two colours the TTS overlay uses, so every "this is a
     threat" mark in the game is rose and every neutral move mark is gold. */
  window.CZ_ARROWS = {
    move:   0xf2d08a,   /* --cz-gold */
    threat: 0xf5919f    /* --cz-rose */
  };

  /* ======================================================================
     BOOT — install the hooks once the game's own modules have all run.
     ====================================================================== */
  hookSlabActivity();
  hookGlassRebuild();
  hookPieceMaterial();
  hookPieceGlow();
  hookSquareHighlights();
  softenLights();
})();
