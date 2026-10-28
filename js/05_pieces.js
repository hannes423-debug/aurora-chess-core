/* ================================================================
   PIECE MATERIAL + HIGHLIGHT SYSTEM
================================================================ */

// Shared sprite textures for Fog and Shadow highlight styles
const _fogSpriteTex = (function() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,   'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.30)');
  g.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
})();

const _shadowSpriteTex = (function() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32,32,2,32,32,32);
  g.addColorStop(0,   'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.25)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
})();

// Clock advanced in anim() for animated presets (Cosmic, Plasma)
let _pieceMaterialClock = 0;
// Dirty flags — set by applyPieceAppearance() so anim() skips traversal when not needed
let _hasCosmicPieces = false;
let _hasGlowPieces   = false;

// Build one material from a piece-side config (CFG.pieces.white or .black)
function buildPieceMaterial(cfg, isOutline) {
  if (isOutline) {
    return new THREE.MeshBasicMaterial({
      color: cfg.outlineColor !== undefined ? cfg.outlineColor : 0x888888,
      side: THREE.BackSide,
    });
  }
  const color   = cfg.color          !== undefined ? cfg.color          : 0xffffff;
  const preset  = cfg.materialPreset  || 'plastic';
  const opacity = cfg.baseOpacity     !== undefined ? cfg.baseOpacity    : 1.0;
  const rough   = cfg.roughness       !== undefined ? cfg.roughness      : 0.4;
  const emHex   = cfg.emissiveColor   !== undefined ? cfg.emissiveColor  : 0x000000;
  const emInt   = cfg.emissiveIntensity !== undefined ? cfg.emissiveIntensity : 0.0;
  let mat;
  switch (preset) {
    case 'ghost':
      mat = new THREE.MeshPhysicalMaterial({
        color, roughness: Math.min(rough, 0.35), metalness: 0,
        transparent: true, opacity: Math.min(opacity, 0.48),
        emissive: new THREE.Color(emHex || 0x4444aa),
        emissiveIntensity: emInt > 0 ? emInt : 0.18,
      });
      // transmission forces a double render pass — skip on mobile to prevent GPU crash
      if (!IS_MOBILE) { try { mat.transmission = 0.45; } catch(e){} }
      break;
    case 'glass':
      mat = new THREE.MeshPhysicalMaterial({
        color, roughness: 0.04, metalness: 0,
        transparent: true, opacity: opacity < 1 ? opacity : 0.15,
        clearcoat: 1.0, clearcoatRoughness: 0.05,
        emissive: new THREE.Color(emHex), emissiveIntensity: emInt,
      });
      if (!IS_MOBILE) { try { mat.transmission = 0.92; mat.ior = 1.5; } catch(e){} }
      break;
    case 'metal':
      mat = new THREE.MeshPhysicalMaterial({
        color, metalness: 1.0, roughness: rough,
        emissive: new THREE.Color(emHex), emissiveIntensity: emInt,
        transparent: opacity < 1, opacity,
      });
      break;
    case 'crystal':
      mat = new THREE.MeshPhysicalMaterial({
        color, roughness: 0.0, metalness: 0.05,
        transparent: true, opacity: Math.min(opacity, 0.65),
        clearcoat: 1.0, clearcoatRoughness: 0.0,
        emissive: new THREE.Color(emHex || 0x001133),
        emissiveIntensity: emInt > 0 ? emInt : 0.08,
      });
      if (!IS_MOBILE) { try { mat.transmission = 0.65; mat.ior = 1.7; } catch(e){} }
      // three.js changed the sheen API in r132: before it `sheen` IS the tint
      // Color, after it `sheen` is a float and the tint is `sheenColor`.
      // This page ships r128, where the float form hands a Number to
      // uniform3fv and throws on the first render — blanking the board.
      if (!IS_MOBILE) { try {
        if ('sheenColor' in mat) { mat.sheen = 0.5; mat.sheenColor = new THREE.Color(0x88aaff); mat.sheenRoughness = 0.1; }
        else                     { mat.sheen = new THREE.Color(0x88aaff); }
      } catch(e){} }
      break;
    case 'cosmic':
      mat = new THREE.MeshPhysicalMaterial({
        color: 0x050508, roughness: 0.15, metalness: 0.6,
        emissive: new THREE.Color(emHex || 0x4400cc),
        emissiveIntensity: emInt > 0 ? emInt : 1.5,
        transparent: true, opacity: opacity > 0 ? opacity : 0.9,
      });
      mat.userData.isCosmic = true;
      mat.userData.cosmicBaseHue = new THREE.Color(emHex || 0x4400cc).getHSL({}).h || 0.77;
      break;
    case 'plastic':
    default:
      mat = new THREE.MeshPhysicalMaterial({
        color, metalness: 0, roughness: rough,
        emissive: new THREE.Color(emHex), emissiveIntensity: emInt,
        transparent: opacity < 1, opacity,
      });
      break;
  }
  return mat;
}

// Remove all highlight/outline child objects from a group
function _clearPieceHighlights(group) {
  const toRemove = [];
  group.traverse(obj => {
    if (obj.userData.isOutline || obj.userData.isHighlightEffect) toRemove.push(obj);
  });
  toRemove.forEach(obj => { if (obj.parent) obj.parent.remove(obj); });
}

// Apply the configured highlight style to a piece group
function _applyHighlightStyle(group) {
  const cfg  = group.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
  const style = cfg.highlightStyle || 'outline';
  // 'outline' uses outlineColor (existing system); other styles use highlightColor
  const hlCol = style === 'outline'
    ? (cfg.outlineColor !== undefined ? cfg.outlineColor : 0x888888)
    : (cfg.highlightColor !== undefined ? cfg.highlightColor : (cfg.outlineColor || 0x888888));
  const thick = cfg.thickness || 0.038;

  _clearPieceHighlights(group);

  switch (style) {
    case 'outline': {
      const meshes = [];
      group.traverse(o => { if (o.isMesh && !o.userData.isOutline && !o.userData.isHighlightEffect) meshes.push(o); });
      const s = 1 + thick;
      meshes.forEach(obj => {
        const ol = new THREE.Mesh(obj.geometry, new THREE.MeshBasicMaterial({ color: hlCol, side: THREE.BackSide }));
        ol.scale.set(s, s, s);
        ol.userData.isOutline = true;
        ol.userData.isHighlightEffect = true;
        obj.add(ol);
      });
      break;
    }
    case 'glow': {
      const mat = new THREE.SpriteMaterial({
        map: _glowTex, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: 0.38, color: new THREE.Color(hlCol),
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(1.7, 1.7, 1.0);
      sp.position.set(0, 0.38, 0);
      sp.userData.isHighlightEffect = true; sp.userData.isGlowHL = true;
      group.add(sp);
      break;
    }
    case 'plasma': {
      const meshes = [];
      group.traverse(o => { if (o.isMesh && !o.userData.isOutline && !o.userData.isHighlightEffect) meshes.push(o); });
      const s = 1 + thick * 1.6;
      meshes.forEach((obj, idx) => {
        const pm = new THREE.MeshBasicMaterial({ color: hlCol, side: THREE.BackSide, transparent: true, opacity: 0.7 });
        const ol = new THREE.Mesh(obj.geometry, pm);
        ol.scale.set(s, s, s);
        ol.userData.isOutline = true;
        ol.userData.isHighlightEffect = true;
        ol.userData.plasmaIdx = idx;
        ol.onBeforeRender = (function(mesh, i) {
          return function() {
            const t = _pieceMaterialClock + i * 0.43;
            const n = Math.sin(t * 3.1) * 0.5 + Math.sin(t * 7.3 + 1.1) * 0.3 + 0.2;
            mesh.material.opacity = 0.35 + Math.max(0, n) * 0.6;
            mesh.material.color.setHSL(((t * 0.04 + i * 0.18) % 1 + 1) % 1, 0.9, 0.6);
          };
        })(ol, idx);
        obj.add(ol);
      });
      break;
    }
    case 'fog': {
      const mat = new THREE.SpriteMaterial({
        map: _fogSpriteTex, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: 0.55, color: new THREE.Color(hlCol),
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(1.9, 0.32, 1.0);
      sp.position.set(0, 0.03, 0);
      sp.userData.isHighlightEffect = true; sp.userData.isFogHL = true;
      group.add(sp);
      break;
    }
    case 'shadow': {
      const mat = new THREE.SpriteMaterial({
        map: _shadowSpriteTex, transparent: true,
        blending: THREE.NormalBlending, depthWrite: false,
        opacity: 0.5, color: 0x000000,
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(1.5, 0.28, 1.0);
      sp.position.set(0, 0.004, 0);
      sp.userData.isHighlightEffect = true; sp.userData.isShadowHL = true;
      group.add(sp);
      break;
    }
    case 'none': default: break;
  }
}

// Rebuild all piece materials + highlights from current CFG
function applyPieceAppearance() {
  _hasCosmicPieces = false;
  _hasGlowPieces   = false;
  pieces.forEach(p => {
    const cfg = p.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
    const isSelected = p === selectedPawn;
    // Rebuild main piece materials
    p.traverse(obj => {
      if (!obj.isMesh || obj.userData.isOutline || obj.userData.isHighlightEffect || obj.userData.isGlow) return;
      const newMat = buildPieceMaterial(cfg, false);
      if (obj.material && obj.material.dispose) obj.material.dispose();
      obj.material = newMat;
      if (newMat.userData && newMat.userData.isCosmic) _hasCosmicPieces = true;
    });
    // Rebuild highlight style
    _applyHighlightStyle(p);
    // Apply selection outline color on top of highlight (outline style only)
    if ((cfg.highlightStyle || 'outline') === 'outline') {
      const oc = isSelected ? (cfg.outlineSelColor || cfg.outlineColor) : (cfg.outlineColor !== undefined ? cfg.outlineColor : 0x888888);
      p.traverse(obj => { if (obj.userData.isOutline) obj.material.color.setHex(oc); });
      setOutlineThickness(p, cfg.thickness || 0.038);
    }
    // Refresh base glow tint
    p.traverse(obj => {
      if (!obj.userData.isGlow || obj.userData.isGlowHL) return;
      obj.material.color.setHex(p.userData.color === 'white' ? 0x88bbff : 0xff8833);
      _hasGlowPieces = true;
    });
  });
}

function _lathe(pts, segs=18) {
  return new THREE.Mesh(new THREE.LatheGeometry(pts, segs), new THREE.MeshBasicMaterial());
}
function _initGroup(g, color, type) {
  const cfg = color === 'white' ? CFG.pieces.white : CFG.pieces.black;
  g.traverse(obj => {
    if (obj.isMesh && !obj.userData.isOutline && !obj.userData.isHighlightEffect)
      obj.material = buildPieceMaterial(cfg, false);
  });
  g.userData.color = color; g.userData.type = type;
  _applyHighlightStyle(g);
  _addGlow(g);
  return g;
}
function _baseProfile(topR, topY) {
  return [
    new THREE.Vector2(0,           0),
    new THREE.Vector2(topR * 1.10, 0),
    new THREE.Vector2(topR * 1.18, 0.03),
    new THREE.Vector2(topR * 1.06, 0.065),
    new THREE.Vector2(topR,        topY)
  ];
}

/* ----------------------------------------------------------
   FUTURISTIC CRYSTAL PIECES  (low-poly / cut-gem aesthetic)
   All bases: flat disc → flared foot → narrow waist → body.
   Cross-sections: 3–8 sides for sharp faceted silhouettes.
   Matching the clear-resin low-poly reference images.
---------------------------------------------------------- */

// Shared flat base disc that all pieces stand on
/* ----------------------------------------------------------
   FLAT ANGULAR SHARDS — BiancoChessWorkshop "Modern Geometric" aesthetic
   Inspired by the reference images: all pieces use flat extruded profiles
   (THREE.ExtrudeGeometry) so every face is a sharp angular plane.
   Each piece has a flat rectangular base slab + one or more shard bodies.
   
   Coordinate convention: profile in X-Y plane, extruded ±Z (thin).
   Pieces stand up in the Y direction.
---------------------------------------------------------- */

// Build a flat extruded shard from 2-D outline pts=[[x,y],...].
// Extruded symmetrically ±Z so piece looks same from both sides.
function _shard(pts, thick=0.09) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for(let i=1;i<pts.length;i++) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, {depth:thick, bevelEnabled:false});
  geo.translate(0, 0, -thick/2);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
}

// Shared flat base slab (w × h × d box, y-centred at h/2)
function _base(g, w=0.28, h=0.044, d=0.11) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshBasicMaterial());
  b.position.y = h/2;
  g.add(b);
  return h; // return y-top of base
}

function pawn(color) {
  // Slim tapered obelisk — single angular shard narrowing to a blunt point
  const g = new THREE.Group();
  const by = _base(g, 0.25, 0.044, 0.10);
  const s = _shard([
    [-0.09,0],[0.09,0],
    [0.065,0.20],[0.028,0.44],[0,0.50],
    [-0.028,0.44],[-0.065,0.20]
  ], 0.09);
  s.position.y = by;
  g.add(s);
  return _initGroup(g, color, 'pawn');
}

function rook(color) {
  // Flat rectangular column with two angular battlements and open notch between them
  const g = new THREE.Group();
  const by = _base(g, 0.30, 0.044, 0.11);
  // Main body
  const body = _shard([[-0.12,0],[0.12,0],[0.12,0.38],[-0.12,0.38]], 0.10);
  body.position.y = by; g.add(body);
  // Left battlement
  const lb = _shard([[-0.12,0.38],[-0.025,0.38],[-0.025,0.55],[-0.12,0.55]], 0.10);
  lb.position.y = by; g.add(lb);
  // Right battlement
  const rb = _shard([[0.025,0.38],[0.12,0.38],[0.12,0.55],[0.025,0.55]], 0.10);
  rb.position.y = by; g.add(rb);
  return _initGroup(g, color, 'rook');
}

function knight(color) {
  // Fork / tuning-fork silhouette — lower trapezoidal body splits into two angular prongs
  const g = new THREE.Group();
  const by = _base(g, 0.27, 0.044, 0.10);
  // Lower body — narrows going up
  const body = _shard([
    [-0.11,0],[0.11,0],[0.08,0.24],[-0.08,0.24]
  ], 0.09);
  body.position.y = by; g.add(body);
  // Left prong — angles outward and tapers to point
  const lp = _shard([
    [-0.08,0.24],[-0.01,0.24],
    [-0.03,0.56],[-0.12,0.53]
  ], 0.09);
  lp.position.y = by; g.add(lp);
  // Right prong
  const rp = _shard([
    [0.01,0.24],[0.08,0.24],
    [0.12,0.53],[0.03,0.56]
  ], 0.09);
  rp.position.y = by; g.add(rp);
  return _initGroup(g, color, 'knight');
}

function bishop(color) {
  // Bishop's mitre — tall narrow shard with distinctive angular shoulder flare and pointed top
  const g = new THREE.Group();
  const by = _base(g, 0.26, 0.044, 0.10);
  const s = _shard([
    [-0.10,0],[0.10,0],
    [0.07,0.28],[0.055,0.40],
    [0.10,0.48],[0.06,0.62],
    [0.02,0.74],[0,0.80],
    [-0.02,0.74],[-0.06,0.62],
    [-0.10,0.48],[-0.055,0.40],
    [-0.07,0.28]
  ], 0.09);
  s.position.y = by; g.add(s);
  return _initGroup(g, color, 'bishop');
}

function queen(color) {
  // Crown of three ascending fins — centre fin tallest, outer fins shorter and swept outward
  const g = new THREE.Group();
  const by = _base(g, 0.32, 0.044, 0.11);
  // Wide lower body — trapezoid
  const body = _shard([
    [-0.13,0],[0.13,0],[0.10,0.33],[-0.10,0.33]
  ], 0.10);
  body.position.y = by; g.add(body);
  // Centre fin (tallest)
  const cf = _shard([
    [-0.030,0.33],[0.030,0.33],
    [0.018,0.72],[0,0.80],[-0.018,0.72]
  ], 0.10);
  cf.position.y = by; g.add(cf);
  // Left outer fin (shorter, angled outward)
  const lf = _shard([
    [-0.10,0.33],[-0.038,0.33],
    [-0.04,0.62],[-0.13,0.58]
  ], 0.08);
  lf.position.y = by; g.add(lf);
  // Right outer fin
  const rf = _shard([
    [0.038,0.33],[0.10,0.33],
    [0.13,0.58],[0.04,0.62]
  ], 0.08);
  rf.position.y = by; g.add(rf);
  return _initGroup(g, color, 'queen');
}

function king(color) {
  // Widest piece — broad lower body + upright cross of two flat bars (perpendicular planes)
  const g = new THREE.Group();
  const by = _base(g, 0.34, 0.044, 0.12);
  // Wide lower body
  const body = _shard([
    [-0.14,0],[0.14,0],[0.11,0.36],[-0.11,0.36]
  ], 0.10);
  body.position.y = by; g.add(body);
  // Vertical cross bar — front-facing shard (X-Y plane)
  const vc = _shard([
    [-0.03,0.36],[0.03,0.36],
    [0.03,0.82],[0,0.88],[-0.03,0.82]
  ], 0.10);
  vc.position.y = by; g.add(vc);
  // Horizontal cross bar — spans in X, thin in Z (same XY plane, visually a cross)
  const hc = _shard([
    [-0.20,0.53],[0.20,0.53],[0.20,0.63],[-0.20,0.63]
  ], 0.10);
  hc.position.y = by; g.add(hc);
  // Second cross dimension — perpendicular shard in Z-Y plane for 3D cross
  const vc2 = _shard([
    [-0.03,0.36],[0.03,0.36],
    [0.03,0.82],[0,0.88],[-0.03,0.82]
  ], 0.10);
  vc2.rotation.y = Math.PI/2;
  vc2.position.y = by; g.add(vc2);
  return _initGroup(g, color, 'king');
}

/* ================================================================
   GLB MODEL LOADING
================================================================ */
const GLB_MODELS = {};
let _glbLoadDone = false;
// On mobile, default to procedural pieces — GLBs can be enabled manually in settings.
// This avoids a large base64 decode + GPU upload spike at startup.
let _glbUseModels = true;

function _loadAllGLBs() {
  const statusEl = document.getElementById('apGlbStatus');

  if (typeof THREE === 'undefined' || !THREE.GLTFLoader) {
    if (statusEl) { statusEl.textContent = 'GLTFLoader not available'; statusEl.style.color = '#cc6633'; }
    _glbLoadDone = true;
    return;
  }

  const loader = new THREE.GLTFLoader();
  const types = Object.keys(_GLB_B64);
  const total = types.length;
  let loaded = 0;
  if (statusEl) statusEl.textContent = 'Loading GLB models… 0/' + total;

  types.forEach(type => {
    const buf = _b64ToArrayBuffer(_GLB_B64[type]);
    loader.parse(buf, '',
      gltf => {
        const meshData = [];
        gltf.scene.updateWorldMatrix(true, true);
        gltf.scene.traverse(obj => {
          if (!obj.isMesh) return;
          obj.updateWorldMatrix(true, false);
          meshData.push({ geo: obj.geometry.clone(), matrix: obj.matrixWorld.clone() });
        });
        if (meshData.length > 0) GLB_MODELS[type] = meshData;
        loaded++;
        if (statusEl) statusEl.textContent = 'Loading GLB… ' + loaded + '/' + total;
        if (loaded === total) _onGLBsReady();
      },
      err => {
        console.warn('[GLB] Failed:', type, err && (err.message || err));
        loaded++;
        if (statusEl) statusEl.textContent = 'GLB error (' + type + ') — check console';
        if (loaded === total) _onGLBsReady();
      }
    );
  });
}

function _onGLBsReady() {
  _glbLoadDone = true;
  const statusEl = document.getElementById('apGlbStatus');
  const nLoaded = Object.keys(GLB_MODELS).length;
  if (statusEl) {
    statusEl.textContent = nLoaded === 6 ? 'GLB models active ✓' : nLoaded + '/6 models loaded';
    statusEl.style.color = nLoaded >= 4 ? '#44cc88' : '#cc8844';
  }
  // Update model chip state
  const chips = document.querySelectorAll('[data-apmodel]');
  chips.forEach(c => c.classList.toggle('active', c.dataset.apmodel === (_glbUseModels ? 'glb' : 'procedural')));
  // Rebuild board pieces with GLB geometry if use-GLB is on
  if (_glbUseModels && pieces.length > 0) _rebuildAllPiecesGeometry();
}

// Build a normalized group from GLB geometry (no materials, no highlights).
// Uses an INNER wrapper so the outer group's position stays at (0,0,0) and
// place() can safely set it without disturbing the Y-floor correction.
function _glbPieceGroup(type) {
  const models = GLB_MODELS[type];
  if (!models || !models.length) return null;

  // Outer group: identity transform — owned by place()/layers[]
  const g     = new THREE.Group();
  // Inner group: holds scale + centering so bottom sits at y=0 in outer space
  const inner = new THREE.Group();
  g.add(inner);

  models.forEach(({ geo, matrix }) => {
    const m = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial());
    m.applyMatrix4(matrix);
    inner.add(m);
  });

  // Measure inner at identity
  const box  = new THREE.Box3().setFromObject(inner);
  const size = new THREE.Vector3(); box.getSize(size);
  const cen  = new THREE.Vector3(); box.getCenter(cen);
  if (size.y < 0.001) return g;

  // world_Y = g.pos.y + inner.pos.y + S * (mesh_local_y + vertex_y)
  // bottom at g.pos.y=0  →  inner.pos.y + S * box.min.y = 0
  //                       →  inner.pos.y = -S * box.min.y
  // XZ centred           →  inner.pos.x = -S * cen.x
  const S = 0.82 / size.y;
  inner.scale.setScalar(S);
  inner.position.set(-S * cen.x, -S * box.min.y, -S * cen.z);
  return g;
}

// Unified piece builder — GLB when ready, procedural fallback
function buildPiece(type, color) {
  if (_glbUseModels && _glbLoadDone) {
    const g = _glbPieceGroup(type);
    if (g) return _initGroup(g, color, type);
  }
  // Procedural fallback
  switch (type) {
    case 'pawn':   return pawn(color);
    case 'rook':   return rook(color);
    case 'knight': return knight(color);
    case 'bishop': return bishop(color);
    case 'queen':  return queen(color);
    case 'king':   return king(color);
    default:       return pawn(color);
  }
}

// Swap ALL board pieces to current geometry source, preserving positions
function _rebuildAllPiecesGeometry() {
  if (!pieces.length) return;
  const snap = pieces.map(p => ({
    type: p.userData.type, color: p.userData.color,
    x: p.userData.x, y: p.userData.y, z: p.userData.z,
    moved: p.userData.moved,
    layer: layers[p.userData.z],
    px: p.position.x, pz: p.position.z,
  }));
  const prevSelected = selectedPawn ? { x: selectedPawn.userData.x, y: selectedPawn.userData.y, z: selectedPawn.userData.z } : null;
  pieces.forEach(p => { if (p.parent) p.parent.remove(p); });
  pieces.length = 0;
  for (const k in boardMap) delete boardMap[k];
  selectedPawn = null;
  snap.forEach(s => {
    const p = buildPiece(s.type, s.color);
    p.position.set(s.px, 0, s.pz);
    p.userData.x = s.x; p.userData.y = s.y; p.userData.z = s.z; p.userData.moved = s.moved;
    s.layer.add(p);
    pieces.push(p);
    boardMap[key(s.x, s.y, s.z)] = p;
  });
  // Restore selection
  if (prevSelected) {
    selectedPawn = pieces.find(p => p.userData.x === prevSelected.x && p.userData.y === prevSelected.y && p.userData.z === prevSelected.z) || null;
  }
}

// Kick off GLB loading after a short delay (lets the page paint first).
// On mobile, skip auto-load — user can enable GLB in settings.
setTimeout(_loadAllGLBs, 150);

/* ================================================================
   PIECE COLOR / APPEARANCE  (applyPieceColors kept for compat)
================================================================ */
function applyPieceColors() {
  applyPieceAppearance();
}

function place(m, x, y, z) {
  m.position.set(-half + (x + 0.5) * SPACING, 0, -half + (y + 0.5) * SPACING);
  layers[z].add(m);
  m.userData.x = x; m.userData.y = y; m.userData.z = z; m.userData.moved = false;
  pieces.push(m);
  boardMap[key(x, y, z)] = m;
}

function placeStartingPieces() {
  // 8×8×4 layout — 3 pawn walls per side (only knights can jump over them):
  //
  //   White (advances +y, +z):
  //     z=0  major pieces at y=0  +  pawn wall at y=1
  //     z=1  pawn wall at y=0  +  pawn wall at y=1   ← 2nd & 3rd walls on layer 1
  //
  //   Black (advances -y, -z):
  //     z=3  major pieces at y=7  +  pawn wall at y=6
  //     z=2  pawn wall at y=7  +  pawn wall at y=6   ← 2nd & 3rd walls on layer 2
  //
  // Promotion: white reaches y=7 (any layer). Black reaches y=0 (any layer).
  for (let x = 0; x < 8; x++) {
    place(buildPiece("pawn","white"), x, 1, 0); // layer 0, rank 1  (wall 1)
    place(buildPiece("pawn","white"), x, 0, 1); // layer 1, rank 0  (wall 2)
    place(buildPiece("pawn","white"), x, 1, 1); // layer 1, rank 1  (wall 3)
    place(buildPiece("pawn","black"), x, 6, 3); // layer 3, rank 6  (wall 1)
    place(buildPiece("pawn","black"), x, 7, 2); // layer 2, rank 7  (wall 2)
    place(buildPiece("pawn","black"), x, 6, 2); // layer 2, rank 6  (wall 3)
  }
  place(buildPiece("rook",  "white"), 0, 0, 0); place(buildPiece("rook",  "white"), 7, 0, 0);
  place(buildPiece("knight","white"), 1, 0, 0); place(buildPiece("knight","white"), 6, 0, 0);
  place(buildPiece("bishop","white"), 2, 0, 0); place(buildPiece("bishop","white"), 5, 0, 0);
  place(buildPiece("queen", "white"), 3, 0, 0); place(buildPiece("king",  "white"), 4, 0, 0);

  place(buildPiece("rook",  "black"), 0, 7, 3); place(buildPiece("rook",  "black"), 7, 7, 3);
  place(buildPiece("knight","black"), 1, 7, 3); place(buildPiece("knight","black"), 6, 7, 3);
  place(buildPiece("bishop","black"), 2, 7, 3); place(buildPiece("bishop","black"), 5, 7, 3);
  place(buildPiece("queen", "black"), 3, 7, 3); place(buildPiece("king",  "black"), 4, 7, 3);
}
placeStartingPieces();

