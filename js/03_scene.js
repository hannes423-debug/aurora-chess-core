/* ======================================================
   THREE.JS SCENE SETUP
====================================================== */
const scene = new THREE.Scene();

function vw() { return window.innerWidth; }
function vh() { return window.innerHeight; }

// Mobile detection — used to gate heavy GPU features
const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && !/Windows NT/.test(navigator.userAgent));

const camera = new THREE.PerspectiveCamera(60, vw() / vh(), 0.1, 1000);
camera.position.set(0, 18, 30);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: true,
  powerPreference: IS_MOBILE ? 'low-power' : 'default',
});
renderer.setClearColor(0x000000, 0); // transparent — body provides base color
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
renderer.setSize(vw(), vh());
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cssText = "display:block;position:fixed;top:0;left:0;z-index:1;pointer-events:none;";

function setGameInputEnabled(enabled) {
  renderer.domElement.style.pointerEvents = enabled ? "auto" : "none";
}

function onResize() {
  const w = vw(), h = vh();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  // Re-snap FLAT mode zoom to match new viewport dimensions instantly
  if (typeof cameraMode !== 'undefined' && cameraMode === CAMERA_MODES.FLAT &&
      typeof camGetTarget === 'function' && typeof layers !== 'undefined') {
    const { pos, look } = camGetTarget(CAMERA_MODES.FLAT, activeZ);
    camera.position.copy(pos);
    _camLookAt.copy(look);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    _camTrans.active = false;
  }
}
window.addEventListener("resize", onResize);
requestAnimationFrame(() => { requestAnimationFrame(onResize); });

const pivot = new THREE.Group();
scene.add(pivot);
pivot.rotation.x = 0.1;
pivot.rotation.y = 3;
pivot.position.y = 2.2;
// The board's home offset, captured rather than hardcoded a second time.
// Pan (18_ctf_input.js) moves the pivot and its reset has to come back HERE,
// not to the origin — resetting to (0,0,0) dropped the board a full 2.2 units
// below where it starts.
const PIVOT_HOME = pivot.position.clone();
window.PIVOT_HOME = PIVOT_HOME;

// Scene lighting — ignored by MeshBasicMaterial board geometry,
// required for MeshPhysicalMaterial piece presets
const _sceneAmbient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(_sceneAmbient);
const _sceneKey = new THREE.DirectionalLight(0xffffff, 0.90);
_sceneKey.position.set(5, 12, 8);
scene.add(_sceneKey);
const _sceneFill = new THREE.DirectionalLight(0x6699ff, 0.35);
_sceneFill.position.set(-5, 4, -6);
scene.add(_sceneFill);
const _sceneRim = new THREE.DirectionalLight(0x440088, 0.22);
_sceneRim.position.set(0, -4, -10);
scene.add(_sceneRim);

/* ======================================================
   GAME STATE
====================================================== */
let turn = "white", playerColor = "white", botColor = null, botDifficulty = 'medium', botDepth = 1;
let BOT_OPTS = { hint: false, undo: false };
let LAYER_VIS = { mode: 'all', count: LAYERS }; // 4 layers — show all by default
let botThinking = false, gameStarted = false, moveNumber = 1;
let _botWorker = null, _botThinkingTimer = null;
let moveLog = [], activeZ = 0, selectedPawn = null, legalMoves = [];
let lastDoublePawn = null; // {px,py,pz,captureX,captureY,captureZ} for en passant
let halfmoveClock = 0; // 50-move rule counter (resets on capture or pawn move)
let selPlate, movePlates = [], pulsePlates = [], pulseT = 0;
let promotionActive = false, animations = [], history = [], lastMoveSquares = [];
let snapshots = [], reviewing = false, threatPlates = [], reviewIndex = -1;
let startMessageMesh = null, reviewArrows = [];
let cosmicGlassActive = false, _cgTime = 0, _cgOrigMats = [], _cgOrigColors = null;

const promotionGroup = new THREE.Group();
scene.add(promotionGroup);

// ===== SETTINGS PREVIEW — state vars (implementation at bottom of script) =====
let previewRenderer, previewScene, previewCam, previewMesh;
let previewDragging=false, previewLastX=0;

