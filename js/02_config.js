/* ======================================================
   ── MESSAGE CONFIG
====================================================== */
// Rounded, friendly type for the in-world messages, to match the UI skin.
// Canvas needs real family names — it cannot fall back through a CSS var.
const MSG_FONT = "'Nunito', ui-rounded, -apple-system, system-ui, sans-serif";

const MSGS = {
  start:     { text:'START',     color:'#dff4ff', size:90,  dur:3,  anim:'pulse', layer:'current', glow:true },
  check:     { text:'CHECK',     color:'#ffc8d8', size:80,  dur:2,  anim:'zap',   layer:'current', glow:true },
  checkmate: { text:'CHECKMATE', color:'#ffb4c8', size:70,  dur:4,  anim:'fade',  layer:'current', glow:true },
  stalemate: { text:'STALEMATE', color:'#d8d3f2', size:70,  dur:4,  anim:'fade',  layer:'current', glow:true }
};
let activeMsgKey = 'start';

function getMsgLayerZ(cfg) {
  if (cfg.layer === 'current') return activeZ;
  if (cfg.layer === 'top')     return LAYERS - 1;
  return Math.max(0, Math.min(LAYERS-1, parseInt(cfg.layer) || 0));
}

function _disposeBoardMsg(mesh) {
  pivot.remove(mesh);
  if (mesh.material) { if (mesh.material.map) mesh.material.map.dispose(); mesh.material.dispose(); }
  if (mesh.geometry) mesh.geometry.dispose();
}
function showBoardMsg(key) {
  const cfg = (typeof key === 'object') ? key : MSGS[key]; if (!cfg) return;
  const lz = getMsgLayerZ(cfg);
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cfg.color;
  ctx.font = '800 ' + cfg.size + 'px ' + (cfg.font || MSG_FONT);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (cfg.glow) { ctx.shadowColor = cfg.color; ctx.shadowBlur = 22; }
  ctx.fillText(cfg.text, 256, 64);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0 })
  );
  mesh.position.set(0, layers[lz].position.y + 1.5, 0);
  orientToPlayer(mesh);
  pivot.add(mesh);
  const durMs = (cfg.dur || 3) * 1000;
  const an = cfg.anim || 'fade';
  if (an === 'fade') {
    const inD = 300, outD = 600;
    let t = 0, phase = 'in';
    (function tick() {
      t += 16;
      if (phase === 'in')        { mesh.material.opacity = Math.min(1, t/inD); if (t >= inD) { t=0; phase='hold'; } }
      else if (phase === 'hold') { if (t >= durMs-inD-outD) { t=0; phase='out'; } }
      else { mesh.material.opacity = Math.max(0, 1-t/outD); if (t >= outD) { _disposeBoardMsg(mesh); return; } }
      requestAnimationFrame(tick);
    })();
  } else if (an === 'zap') {
    let t = 0, phase = 'in';
    (function tick() {
      t += 16;
      if (phase === 'in') {
        mesh.material.opacity = t<50?1:t<100?0:t<150?1:t<200?0:1;
        mesh.scale.x = 1 + Math.sin(t*0.2)*0.04;
        if (t >= 250) { t=0; phase='hold'; }
      } else if (phase === 'hold') {
        mesh.material.opacity = 1;
        if (t >= durMs-400) { t=0; phase='out'; }
      } else {
        mesh.material.opacity = Math.max(0, 1-t/300);
        if (t >= 300) { _disposeBoardMsg(mesh); return; }
      }
      requestAnimationFrame(tick);
    })();
  } else if (an === 'slide') {
    const baseY = layers[lz].position.y + 1.5;
    mesh.position.y = baseY - 2; let t = 0, phase = 'in';
    (function tick() {
      t += 16;
      if (phase === 'in')        { const p=Math.min(1,t/400); mesh.position.y=(baseY-2)+p*2; mesh.material.opacity=p; if(t>=400){t=0;phase='hold';} }
      else if (phase === 'hold') { if(t>=durMs-700){t=0;phase='out';} }
      else { mesh.material.opacity=Math.max(0,1-t/300); mesh.position.y+=0.01; if(t>=300){_disposeBoardMsg(mesh);return;} }
      requestAnimationFrame(tick);
    })();
  } else { // pulse
    let t = 0;
    (function tick() {
      t += 16;
      mesh.material.opacity = 0.6 + Math.sin(t*0.005)*0.4;
      if (t >= durMs) {
        let f=0;
        (function fade(){ f+=16; mesh.material.opacity=Math.max(0,1-f/400); if(f<400)requestAnimationFrame(fade);else _disposeBoardMsg(mesh); })();
        return;
      }
      requestAnimationFrame(tick);
    })();
  }
}

function syncMsgUI() {
  const cfg = MSGS[activeMsgKey];
  const msgText  = document.getElementById('msgText');
  const msgColor = document.getElementById('msgColor');
  const msgSize  = document.getElementById('msgSize');
  const msgDur   = document.getElementById('msgDur');
  const msgGlow  = document.getElementById('msgGlow');
  if (msgText)  msgText.value   = cfg.text;
  if (msgColor) msgColor.value  = cfg.color;
  if (msgSize)  msgSize.value   = cfg.size;
  if (msgDur)   msgDur.value    = cfg.dur;
  if (msgGlow)  msgGlow.checked = cfg.glow;
  document.querySelectorAll('[data-msganim]').forEach(b  => b.classList.toggle('active', b.dataset.msganim  === cfg.anim));
  document.querySelectorAll('[data-msglayer]').forEach(b => b.classList.toggle('active', b.dataset.msglayer === String(cfg.layer)));
}

/* ======================================================
   ── DYNAMIC BACKGROUND
====================================================== */
const BG = {
  type: 'grid', color: '#120020',
  starColor: '#b4c8ff', nebulaAccentColor: '#5000a0',
  cvs: document.getElementById('bgCanvas'),
  img: document.getElementById('bgPhoto'),
  aid: null, stars: [], t: 0,
  apply(type) {
    BG.type = type;
    cancelAnimationFrame(BG.aid);
    BG.cvs.style.display = 'none'; BG.img.style.display = 'none';
    renderer.setClearColor(0, 0); // always transparent — body + globalBg handle base
    document.body.style.background = '#120020';
    document.querySelectorAll('[data-bg]').forEach(b => b.classList.toggle('active', b.dataset.bg === type));
    document.querySelectorAll('#bgPhotoRow,#bgPhotoRowAdv').forEach(function(el){el.style.display=type==='photo'?'block':'none';});
    // Show bg color picker for grid and color modes
    const bBgColorRow = document.getElementById('bBgColorRow');
    if (bBgColorRow) bBgColorRow.style.display = (type === 'grid' || type === 'color') ? 'flex' : 'none';
    // Show star/nebula color pickers
    document.querySelectorAll('.bgStarColorRow').forEach(function(el){el.style.display=(type==='stars'||type==='nebula')?'':'none';});
    document.querySelectorAll('.bgNebulaColorRow').forEach(function(el){el.style.display=type==='nebula'?'':'none';});

    const gbEl = document.getElementById('globalBg');
    if (type === 'grid') {
      // Grid pulse IS the background — show globalBg, body tints the void
      document.body.style.background = BG.color;
      if (gbEl) gbEl.style.display = 'block';
    } else if (type === 'color') {
      // True flat background — no animation
      if (gbEl) gbEl.style.display = 'none';
      document.body.style.background = BG.color;
      renderer.setClearColor(0, 0);
    } else if (type === 'photo') {
      if (gbEl) gbEl.style.display = 'none';  // photo covers everything
      if (BG.img.src && BG.img.src !== location.href) BG.img.style.display = 'block';
    } else {
      // stars / nebula — bgCanvas animates over body background color
      document.body.style.background = BG.color;
      if (gbEl) gbEl.style.display = 'none';
      BG.cvs.style.display = 'block';
      BG.cvs.width = window.innerWidth; BG.cvs.height = window.innerHeight;
      if (!BG.stars.length) BG._initStars();
      if (type==='stars')  BG._animStars();
      if (type==='nebula') BG._animNebula();
    }
  },
  _initStars() { BG.stars=Array.from({length:200},()=>({x:Math.random(),y:Math.random(),r:Math.random()*1.4+0.2,s:Math.random()*0.003+0.001,b:Math.random()})); },
  _animStars() {
    BG.t+=0.01; const ctx=BG.cvs.getContext('2d'),W=BG.cvs.width,H=BG.cvs.height;
    ctx.fillStyle='#000000'; ctx.fillRect(0,0,W,H);
    const sc=BG.starColor,sr=parseInt(sc.slice(1,3),16),sg=parseInt(sc.slice(3,5),16),sb=parseInt(sc.slice(5,7),16);
    BG.stars.forEach(s=>{ s.b+=s.s; if(s.b>1)s.b=0; const a=0.3+Math.abs(Math.sin(s.b*Math.PI))*0.7; ctx.beginPath(); ctx.arc(s.x*W,s.y*H,s.r,0,Math.PI*2); ctx.fillStyle=`rgba(${sr},${sg},${sb},${a})`; ctx.fill(); });
    if(Math.random()<0.003){ const sx=Math.random()*W,sy=Math.random()*H*0.5; ctx.strokeStyle=`rgba(${sr},${sg},${sb},0.6)`; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+80,sy+30); ctx.stroke(); }
    BG.aid=requestAnimationFrame(BG._animStars.bind(BG));
  },
  _animNebula() {
    BG.t+=0.005; const ctx=BG.cvs.getContext('2d'),W=BG.cvs.width,H=BG.cvs.height;
    ctx.fillStyle='#000000'; ctx.fillRect(0,0,W,H);
    const na=BG.nebulaAccentColor,nr=parseInt(na.slice(1,3),16),ng_=parseInt(na.slice(3,5),16),nb=parseInt(na.slice(5,7),16);
    [{cx:0.3+Math.sin(BG.t*0.7)*0.15,cy:0.4+Math.cos(BG.t*0.5)*0.1,r:0.35,a:0.18},{cx:0.7+Math.cos(BG.t*0.6)*0.12,cy:0.5+Math.sin(BG.t*0.4)*0.12,r:0.28,a:0.14},{cx:0.5+Math.sin(BG.t*0.9)*0.1,cy:0.7+Math.cos(BG.t*0.8)*0.08,r:0.22,a:0.12}]
    .forEach(cl=>{ const gx=cl.cx*W,gy=cl.cy*H,gr=cl.r*Math.max(W,H),g=ctx.createRadialGradient(gx,gy,0,gx,gy,gr); g.addColorStop(0,`rgba(${nr},${ng_},${nb},${cl.a})`); g.addColorStop(1,`rgba(${nr},${ng_},${nb},0)`); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); });
    const sc=BG.starColor,sr=parseInt(sc.slice(1,3),16),sg=parseInt(sc.slice(3,5),16),sb=parseInt(sc.slice(5,7),16);
    BG.stars.forEach(s=>{ s.b+=s.s*0.5; const a=0.15+Math.abs(Math.sin(s.b*Math.PI))*0.5; ctx.beginPath(); ctx.arc(s.x*W,s.y*H,s.r*0.8,0,Math.PI*2); ctx.fillStyle=`rgba(${sr},${sg},${sb},${a})`; ctx.fill(); });
    BG.aid=requestAnimationFrame(BG._animNebula.bind(BG));
  },
  _animGrid() {
    BG.t+=0.008; const ctx=BG.cvs.getContext('2d'),W=BG.cvs.width,H=BG.cvs.height,sp=40,off=(BG.t*20)%sp;
    ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(0,255,180,0.06)'; ctx.lineWidth=0.5; ctx.beginPath();
    for(let x=-sp+off;x<W+sp;x+=sp){ctx.moveTo(x,0);ctx.lineTo(x,H);}
    for(let y=-sp+off;y<H+sp;y+=sp){ctx.moveTo(0,y);ctx.lineTo(W,y);}
    ctx.stroke();
    const hy=H*0.6,gh=ctx.createLinearGradient(0,hy-60,0,hy+40); gh.addColorStop(0,'rgba(0,255,180,0)'); gh.addColorStop(0.5,'rgba(0,255,180,0.04)'); gh.addColorStop(1,'rgba(0,255,180,0)'); ctx.fillStyle=gh; ctx.fillRect(0,hy-60,W,100);
    BG.aid=requestAnimationFrame(BG._animGrid.bind(BG));
  }
};

function saveBGColors() {
  try { localStorage.setItem('cc_bg_colors', JSON.stringify({starColor:BG.starColor,nebulaColor:BG.nebulaAccentColor})); } catch(e) {}
}
function loadBGColors() {
  try {
    const s=JSON.parse(localStorage.getItem('cc_bg_colors')||'null');
    if(s){ if(s.starColor) BG.starColor=s.starColor; if(s.nebulaColor) BG.nebulaAccentColor=s.nebulaColor; }
  } catch(e) {}
}
loadBGColors();

// Persist background type across reloads — wrap BG.apply early (safe, no renderer needed)
const _origBGApply = BG.apply.bind(BG);
BG.apply = function(type) {
  _origBGApply(type);
  try { localStorage.setItem('cc_bg_type', type); } catch(e) {}
};
// NOTE: restoreBGType() is called later after renderer is initialised (see below)

/* ======================================================
   ── PRESETS
====================================================== */
const PRESETS = {
  void:    { bg:'stars',              hl:{legal:{c:0xffffff,op:0.28},threats:{c:0xff3344,op:0.35},lastMove:{c:0x3399ff,op:0.45},sel:{c:0x00ffcc,op:0.9}},  grid:{ac:'#ffffff',ao:0.5,dc:'#ffffff',dop:0.04}, pieces:{wc:0xffffff,wo:0x666666,ws:0x00ffcc,bc:0x555566,bo:0x333333,bs:0xff6600} },
  light:   { bg:'grid',bgCol:'#e8e0d0', hl:{legal:{c:0x2255cc,op:0.35},threats:{c:0xcc2222,op:0.4},lastMove:{c:0x2255aa,op:0.5},sel:{c:0x0044cc,op:0.9}},  grid:{ac:'#222222',ao:0.55,dc:'#444444',dop:0.07}, pieces:{wc:0xf0e8d0,wo:0x999988,ws:0x0044cc,bc:0x3a2a1a,bo:0x111111,bs:0xcc4400} },
  highvis: { bg:'grid',bgCol:'#000000',hl:{legal:{c:0x00ff00,op:0.5},threats:{c:0xff0000,op:0.6},lastMove:{c:0xffff00,op:0.7},sel:{c:0x00ff00,op:1.0}},  grid:{ac:'#ffff00',ao:0.8,dc:'#888800',dop:0.14}, pieces:{wc:0xffffff,wo:0x888888,ws:0x00ff00,bc:0xffff00,bo:0x888800,bs:0x00ff00} },
  neon:    { bg:'nebula',             hl:{legal:{c:0x00ffff,op:0.35},threats:{c:0xff0055,op:0.45},lastMove:{c:0xff00ff,op:0.5},sel:{c:0x00ffff,op:1.0}}, grid:{ac:'#ff00ff',ao:0.5,dc:'#440044',dop:0.07}, pieces:{wc:0xeeffff,wo:0x446666,ws:0x00ffff,bc:0xff44aa,bo:0x661133,bs:0xff00ff} },
  amber:   { bg:'grid',               hl:{legal:{c:0xffaa00,op:0.3},threats:{c:0xff3300,op:0.4},lastMove:{c:0xffcc44,op:0.5},sel:{c:0xffaa00,op:1.0}},  grid:{ac:'#ffaa00',ao:0.6,dc:'#442200',dop:0.07}, pieces:{wc:0xffddaa,wo:0x886644,ws:0xffaa00,bc:0x663300,bo:0x221100,bs:0xff6600} }
};

function applyPreset(name) {
  const P = PRESETS[name]; if (!P) return;
  if (P.bgCol) { BG.color=P.bgCol; document.getElementById('bgColor').value=P.bgCol; }
  BG.apply(P.bg);
  CFG.grid.activeColor=hexToInt(P.grid.ac); CFG.grid.activeOpacity=P.grid.ao;
  CFG.grid.dimColor=hexToInt(P.grid.dc);    CFG.grid.dimOpacity=P.grid.dop;
  document.getElementById('gridActiveColor').value=P.grid.ac;
  document.getElementById('gridActiveOpacity').value=Math.round(P.grid.ao*100);
  document.getElementById('gridDimColor').value=P.grid.dc;
  document.getElementById('gridDimOpacity').value=Math.round(P.grid.dop*100);
  const ck={legal:'hlLegalColor',threats:'hlThreatsColor',lastMove:'hlLastMoveColor',sel:'hlSelectionColor'};
  const ok={legal:'hlLegalOpacity',threats:'hlThreatsOpacity',lastMove:'hlLastMoveOpacity',sel:'hlSelectionOpacity'};
  const map={legal:'legal',threats:'threats',lastMove:'lastMove',sel:'selection'};
  Object.keys(P.hl).forEach(k=>{
    CFG.hl[map[k]].color=P.hl[k].c; CFG.hl[map[k]].opacity=P.hl[k].op;
    if(ck[k])document.getElementById(ck[k]).value=intToHex(P.hl[k].c);
    if(ok[k])document.getElementById(ok[k]).value=Math.round(P.hl[k].op*100);
  });
  CFG.pieces.white.color=P.pieces.wc; CFG.pieces.white.outlineColor=P.pieces.wo; CFG.pieces.white.outlineSelColor=P.pieces.ws;
  CFG.pieces.black.color=P.pieces.bc; CFG.pieces.black.outlineColor=P.pieces.bo; CFG.pieces.black.outlineSelColor=P.pieces.bs;
  document.getElementById('whitePieceColor').value=intToHex(P.pieces.wc);
  document.getElementById('whiteOutlineColor').value=intToHex(P.pieces.wo);
  document.getElementById('whiteOutlineSelColor').value=intToHex(P.pieces.ws);
  document.getElementById('blackPieceColor').value=intToHex(P.pieces.bc);
  document.getElementById('blackOutlineColor').value=intToHex(P.pieces.bo);
  document.getElementById('blackOutlineSelColor').value=intToHex(P.pieces.bs);
  applyPieceColors(); update();
  refreshLegalMoveHighlights(); refreshThreatHighlights(); refreshLastMove();
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===name));
}

// Piece-only preset: applies piece colors/outlines WITHOUT touching the background.
function applyPieceOnlyPreset(name) {
  const P = PRESETS[name]; if (!P) return;
  CFG.pieces.white.color=P.pieces.wc; CFG.pieces.white.outlineColor=P.pieces.wo; CFG.pieces.white.outlineSelColor=P.pieces.ws;
  CFG.pieces.black.color=P.pieces.bc; CFG.pieces.black.outlineColor=P.pieces.bo; CFG.pieces.black.outlineSelColor=P.pieces.bs;
  document.getElementById('whitePieceColor').value=intToHex(P.pieces.wc);
  document.getElementById('whiteOutlineColor').value=intToHex(P.pieces.wo);
  document.getElementById('whiteOutlineSelColor').value=intToHex(P.pieces.ws);
  document.getElementById('blackPieceColor').value=intToHex(P.pieces.bc);
  document.getElementById('blackOutlineColor').value=intToHex(P.pieces.bo);
  document.getElementById('blackOutlineSelColor').value=intToHex(P.pieces.bs);
  const bw=document.getElementById('bWhitePieceColor'); if(bw) bw.value=intToHex(P.pieces.wc);
  const bb=document.getElementById('bBlackPieceColor'); if(bb) bb.value=intToHex(P.pieces.bc);
  applyPieceColors(); update();
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===name));
  if(typeof drawSettingsPreview==='function') drawSettingsPreview('pagePieces');
}

/* ======================================================
   ── LAYER FLASH
====================================================== */
let _lfTimer = null;
function flashLayerIndicator(z) {
  const el = document.getElementById('layerFlash');
  el.textContent = 'L' + (z+1);
  el.style.opacity = '1';
  clearTimeout(_lfTimer);
  _lfTimer = setTimeout(() => { el.style.opacity = '0'; }, 600);
}

/* ======================================================
   SETTINGS STATE
====================================================== */
const CFG = {
  hl: {
    legal:     { on: true,  color: 0xffffff, opacity: 0.32 },
    threats:   { on: true,  color: 0xff3333, opacity: 0.35 },
    lastMove:  { on: true,  color: 0x44aaff, opacity: 0.50 },
    selection: { on: true,  color: 0xffffff, opacity: 0.75 }
  },
  grid: {
    activeColor:   0xffffff, activeOpacity:  0.60,
    dimColor:      0xffffff, dimOpacity:     0.05,
    thickness:     1
  },
  cosmicGlass: { activeOpacity: 0.25, dimOpacity: 0.08 },
  bg: { color: '#000000' },
  pieces: {
    white: {
      color: 0xddeeff, outlineColor: 0x6688aa, outlineSelColor: 0x00ffff, thickness: 0.038,
      materialPreset: 'ghost', baseOpacity: 0.9,
      emissiveColor: 0x4466bb, emissiveIntensity: 0.22,
      roughness: 0.35,
      highlightStyle: 'outline', highlightColor: 0x6688aa,
      useGLB: true,
    },
    black: {
      color: 0x8899bb, outlineColor: 0x334455, outlineSelColor: 0xff5500, thickness: 0.038,
      materialPreset: 'ghost', baseOpacity: 0.9,
      emissiveColor: 0x221133, emissiveIntensity: 0.18,
      roughness: 0.35,
      highlightStyle: 'outline', highlightColor: 0x334455,
      useGLB: true,
    }
  },
  piecePresetSlots: [null, null, null, null], // 4 saved appearance preset slots
};
function saveCFGToStorage() {
  try { localStorage.setItem('cc_cfg', JSON.stringify(CFG)); } catch(e) {}
}
function loadCFGFromStorage() {
  try {
    var s = JSON.parse(localStorage.getItem('cc_cfg') || 'null');
    if (!s) return;
    if (s.hl)           { Object.assign(CFG.hl.legal, s.hl.legal||{}); Object.assign(CFG.hl.threats, s.hl.threats||{}); Object.assign(CFG.hl.lastMove, s.hl.lastMove||{}); Object.assign(CFG.hl.selection, s.hl.selection||{}); }
    if (s.grid)         Object.assign(CFG.grid,         s.grid);
    if (s.cosmicGlass)  Object.assign(CFG.cosmicGlass,  s.cosmicGlass);
    if (s.pieces)            { Object.assign(CFG.pieces.white, s.pieces.white||{}); Object.assign(CFG.pieces.black, s.pieces.black||{}); }
    if (s.piecePresetSlots)  CFG.piecePresetSlots = s.piecePresetSlots;
  } catch(e) {}
}
loadCFGFromStorage();

function hexToInt(hex) { return parseInt(hex.replace('#',''), 16); }
function intToHex(i)   { return '#' + i.toString(16).padStart(6,'0'); }

/* ======================================================
   CONFIG / CONSTANTS
====================================================== */
const BOARD = 8, SPACING = 1.2, half = (BOARD * SPACING) / 2;
// 8×8×4 variant: board is 8×8 in XY, only 4 layers deep in Z.
// Halves the search space → stronger AI at same depth.
const LAYERS = 4;
// Vertical gap between layers (units). Minimum = SPACING = 1.2.
let LAYER_SPACING = 2.0;

