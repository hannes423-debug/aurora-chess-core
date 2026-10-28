/* ======================================================
   BOARD GENERATION
====================================================== */
const boardMap = {};
const holeSquares = new Set();  // arcade holes — "x_y_z" keys
function key(x, y, z) { return x + "_" + y + "_" + z; }
function occ(x, y, z) { return boardMap[key(x, y, z)]; }
function isHole(x, y, z) { return holeSquares.has(key(x, y, z)); }

const layers = [], layerPlanes = [];
const gridLines = [];

function buildBoard() {
  // Build a reusable canvas texture for the triangulated-grid pattern on light squares
  function makeSquareTex(isLight) {
    const size = 64;
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const cx = cv.getContext('2d');
    if (isLight) {
      // Bright geometric pattern — high contrast white squares
      cx.fillStyle = '#2a2a2a';
      cx.fillRect(0, 0, size, size);
      // Triangulated grid lines
      cx.strokeStyle = 'rgba(255,255,255,0.65)';
      cx.lineWidth = 1.2;
      const s = size;
      const lines = [
        [0,0,s,0],[s,0,s,s],[s,s,0,s],[0,s,0,0],
        [0,0,s,s],[s,0,0,s],
        [s/2,0,s,s/2],[s,s/2,s/2,s],[s/2,s,0,s/2],[0,s/2,s/2,0]
      ];
      lines.forEach(([x1,y1,x2,y2])=>{ cx.beginPath();cx.moveTo(x1,y1);cx.lineTo(x2,y2);cx.stroke(); });
    } else {
      // Dark squares: clearly visible dark glass look
      cx.fillStyle = '#1a1a22';
      cx.fillRect(0, 0, size, size);
      cx.strokeStyle = 'rgba(255,255,255,0.10)';
      cx.lineWidth = 0.7;
      const sd = size;
      cx.beginPath(); cx.moveTo(0,0); cx.lineTo(sd,sd); cx.stroke();
      cx.beginPath(); cx.moveTo(sd,0); cx.lineTo(0,sd); cx.stroke();
    }
    return new THREE.CanvasTexture(cv);
  }
  const lightTex = makeSquareTex(true);
  const darkTex  = makeSquareTex(false);

  for (let z = 0; z < LAYERS; z++) {
    const layer = new THREE.Group();
    const planes = [];
    for (let x = 0; x < BOARD; x++) {
      for (let y = 0; y < BOARD; y++) {
        const isLight = (x + y) % 2 === 0;  // A1=x7,y0: (7+0)%2=1≠0 → isLight=false → darkTex → A1 BLACK ✓
        const p = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: isLight ? lightTex : darkTex, transparent: false, side: THREE.FrontSide })
        );
        p.visible = false;
        p.rotation.x = -Math.PI / 2;
        p.position.set(-half + (x + 0.5) * SPACING, 0, -half + (y + 0.5) * SPACING);
        p.userData = { x, y, z, isLight };
        layer.add(p);
        planes.push(p);
      }
    }
    const pts = [];
    for (let i = 0; i <= BOARD; i++) {
      const pos = -half + i * SPACING;
      pts.push(new THREE.Vector3(-half, 0, pos)); pts.push(new THREE.Vector3(half, 0, pos));
      pts.push(new THREE.Vector3(pos, 0, -half)); pts.push(new THREE.Vector3(pos, 0, half));
    }
    const gl = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, linewidth: 1, depthWrite: false })
    );
    layer.add(gl);
    gridLines.push(gl);
    layer.position.y = (z - LAYERS / 2) * LAYER_SPACING;
    pivot.add(layer);
    layers.push(layer);
    layerPlanes.push(planes);
  }
}
buildBoard();

// Shared geometry/material for hole void meshes
// Slightly oversized to cover grid line endpoints at square edges
const _holeVoidGeo = new THREE.PlaneGeometry(SPACING + 0.10, SPACING + 0.10);
// transparent:true puts this in the same render pass as grid lines (which are also transparent).
// renderOrder:999 (set per-mesh) ensures it draws LAST, covering any grid lines beneath.
// opacity:1 makes it fully opaque visually while still being in the transparent pass.
const _holeVoidMat = new THREE.MeshBasicMaterial({
  color: 0x120020, transparent: true, opacity: 1.0,
  depthWrite: true, depthTest: true, side: THREE.DoubleSide
});

// Rebuild grid for layer z, removing line segments that border or touch hole squares.
// Replaces the geometry object entirely to avoid Three.js r128 VAO-cache stale draws.
function rebuildLayerGrid(z) {
  const S=SPACING, B=BOARD, vecs=[];
  // Horizontal segments (run along X, constant Z boundary between rows)
  for(let j=0;j<=B;j++){
    for(let i=0;i<B;i++){
      // Skip if either adjacent square is a hole, OR if either endpoint corner touches a hole
      const adjHole = (j>0&&isHole(i,j-1,z))||(j<B&&isHole(i,j,z));
      const startCorner = (i>0&&j>0&&isHole(i-1,j-1,z))||(i>0&&j<B&&isHole(i-1,j,z));
      const endCorner   = (i+1<B&&j>0&&isHole(i+1,j-1,z))||(i+1<B&&j<B&&isHole(i+1,j,z));
      if(adjHole||startCorner||endCorner) continue;
      vecs.push(new THREE.Vector3(-half+i*S,0,-half+j*S),
                new THREE.Vector3(-half+(i+1)*S,0,-half+j*S));
    }
  }
  // Vertical segments (run along Z, constant X boundary between files)
  for(let i=0;i<=B;i++){
    for(let j=0;j<B;j++){
      const adjHole = (i>0&&isHole(i-1,j,z))||(i<B&&isHole(i,j,z));
      const startCorner = (i>0&&j>0&&isHole(i-1,j-1,z))||(i<B&&j>0&&isHole(i,j-1,z));
      const endCorner   = (i>0&&j+1<B&&isHole(i-1,j+1,z))||(i<B&&j+1<B&&isHole(i,j+1,z));
      if(adjHole||startCorner||endCorner) continue;
      vecs.push(new THREE.Vector3(-half+i*S,0,-half+j*S),
                new THREE.Vector3(-half+i*S,0,-half+(j+1)*S));
    }
  }
  const oldGl = gridLines[z];
  const newGeo = new THREE.BufferGeometry().setFromPoints(
    vecs.length ? vecs : [new THREE.Vector3(),new THREE.Vector3()]
  );
  const newGl = new THREE.LineSegments(newGeo, oldGl.material);
  oldGl.parent.add(newGl);
  oldGl.parent.remove(oldGl);
  oldGl.geometry.dispose();
  gridLines[z] = newGl;
}

function rebuildLayerPositions() {
  layers.forEach((layer, z) => {
    layer.position.y = (z - LAYERS / 2) * LAYER_SPACING;
  });
  update();
  coords();
}

function applyGridSettings() {
  gridLines.forEach((gl, i) => {
    gl.material.color.setHex(i === activeZ ? CFG.grid.activeColor : CFG.grid.dimColor);
    gl.material.opacity = i === activeZ ? CFG.grid.activeOpacity : CFG.grid.dimOpacity;
    gl.material.linewidth = CFG.grid.thickness;
  });
}

/* ======================================================
   PIECE SYSTEM
====================================================== */
const pieces = [];

function makeMaterial(color) { return new THREE.MeshBasicMaterial({ color }); }
function getPieceColor(colorStr) { return colorStr === "white" ? CFG.pieces.white.color : CFG.pieces.black.color; }

function setPieceMat(piece, props) {
  piece.traverse(obj => {
    if (!obj.isMesh) return;
    if ('color' in props && !obj.userData.isOutline) obj.material.color.setHex(props.color);
    if ('opacity'     in props) obj.material.opacity     = props.opacity;
    if ('transparent' in props) obj.material.transparent = props.transparent;
  });
}

function setOutlineColor(piece, colorHex) {
  piece.traverse(obj => { if (obj.userData.isOutline) obj.material.color.setHex(colorHex); });
}
function setOutlineThickness(piece, t) {
  const s = 1 + t;
  piece.traverse(obj => { if (obj.userData.isOutline) obj.scale.set(s, s, s); });
}
function _addOutlines(group) {
  const cfg = group.userData.color === 'white' ? CFG.pieces.white : CFG.pieces.black;
  const meshes = [];
  group.traverse(obj => { if (obj.isMesh && !obj.userData.isOutline) meshes.push(obj); });
  meshes.forEach(obj => {
    const ol = new THREE.Mesh(obj.geometry, new THREE.MeshBasicMaterial({
      color: cfg.outlineColor, side: THREE.BackSide
    }));
    const s = 1 + cfg.thickness;
    ol.scale.set(s, s, s);
    ol.userData.isOutline = true;
    obj.add(ol);
  });
}

function findPieceRoot(obj) {
  while (obj) { if (pieces.includes(obj)) return obj; obj = obj.parent; }
  return null;
}

/* ── Piece glow system ──────────────────────────────────────────
   Each piece gets a THREE.Sprite using AdditiveBlending so it
   brightens the area around the piece without changing its colour.
   Opacity is animated per-frame in anim() — just float math,
   no geometry per frame, no shader compilation needed.
─────────────────────────────────────────────────────────────── */
const _glowCanvas = (function() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32,32,2,32,32,32);
  g.addColorStop(0,   'rgba(255,255,255,0.90)');
  g.addColorStop(0.35,'rgba(255,255,255,0.40)');
  g.addColorStop(0.65,'rgba(255,255,255,0.12)');
  g.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
})();
const _glowTex = new THREE.CanvasTexture(_glowCanvas);

function _addGlow(group) {
  var isWhite = group.userData.color === 'white';
  var mat = new THREE.SpriteMaterial({
    map: _glowTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.18
  });
  // White pieces glow cool blue, black pieces glow warm amber
  mat.color.setHex(isWhite ? 0x88bbff : 0xff8833);
  var sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.1, 1.1, 1.0);
  sprite.position.set(0, 0.25, 0);
  sprite.userData.isGlow = true;
  group.add(sprite);
}

