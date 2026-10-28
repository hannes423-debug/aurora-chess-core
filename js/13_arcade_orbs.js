/* ================================================================
   ██████╗  █████╗ ███╗   ███╗███████╗
  ██╔════╝ ██╔══██╗████╗ ████║██╔════╝
  ██║  ███╗███████║██╔████╔██║█████╗
  ██║   ██║██╔══██║██║╚██╔╝██║██╔══╝
  ╚██████╔╝██║  ██║██║ ╚═╝ ██║███████╗
   ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝
  ARCADE MODULE — fully additive, zero effect when OFF
  All arcade code is appended below. Existing functions are
  wrapped (never replaced). When arcadeSettings.enabled = false
  every wrapper immediately delegates to the original function.
================================================================ */

/* ── Settings object ── */
const arcadeSettings = {
  enabled:        false,
  randomEvents:   true,
  spawnRate:      'medium',    // 'low' | 'medium' | 'high'
  laserMode:      'all',       // 'off' | 'column' | 'row' | 'wall' | 'all'
  regenInterval:  'off',       // 'off' | 'slow' (16t) | 'medium' (8t) | 'fast' (4t)
  regenChance:    '50',        // '25' | '50' | '100'
  compaction:     false,
  compactInterval:'12'         // '8' | '12' | '20' turns
};

/* ── Orb definitions ── */
const ORB_DEFS = {
  power:             { color:0xff9900, label:'POWER ORB',         power:null,             forType:null     },
  gravity_tesseract: { color:0x7B2FBE, label:'TESSERACT ORB',     power:null,             forType:null     },
  laser_instant:     { color:0xff1111, label:'LASER ORB',         power:null,             forType:null     }
};
const SPAWN_INTERVALS = { low:7, medium:4, high:2 };

/* ── Runtime state (all reset on game start) ── */
let arcadeActive       = false;
let activeOrbs         = [];   // [{x,y,z,type,mesh,t,turnsLeft}]
let arcadeScore        = { white:0, black:0 }; // cumulative
let arcadeTurnCount    = 0;
let nextOrbSpawn       = 3;
let nextEventTurn      = 8;
// King double-move
let arcadeDblPending   = false;
let arcadeDblColor     = null;
let arcadeDblPiece     = null;
const pieceAuras       = new WeakMap();
// Holes & laser
const holeMarkers      = new Map(); // key -> THREE.Mesh (void visual inside layer group)
let boardW = 8, boardH = 8, boardD = LAYERS;
let laserWarning       = null; // {type,axis,origin,dir,length,turnsLeft,targets,warningMeshes}

/* ================================================================
   VISUAL HELPERS
================================================================ */
function arcadeAnnounce(text, colorInt) {
  const el = document.getElementById('arcadeEventBanner');
  const hex = '#' + colorInt.toString(16).padStart(6,'0');
  el.textContent = text;
  el.style.color = hex;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
}

function arcadeLogEntry(text, css) {
  const panel = document.getElementById('movePanel');
  if (!panel) return;
  const div = document.createElement('div');
  div.textContent = text;
  div.style.cssText = 'font-size:9px;color:'+css+';padding:1px 0 1px 6px;border-left:2px solid '+css+';margin:2px 0;line-height:1.4;opacity:0.9;';
  panel.appendChild(div);
  panel.scrollTop = panel.scrollHeight;
}

function updateArcadeBar() {
  if (!arcadeActive) return;
  const parts = [];
  if (arcadeDblPending)         parts.push('👑 DOUBLE MOVE!');
  if (laserWarning)             parts.push('🔴 LASER (' + Math.ceil(laserWarning.turnsLeft/2) + ' turn(s))');
  if (holeSquares.size)         parts.push('🕳 ' + holeSquares.size + ' HOLE(S)');
  if (boardW!==8||boardH!==8||boardD!==LAYERS) parts.push(boardW+'×'+boardH+'×'+boardD);
  document.getElementById('arcadeBarText').textContent = parts.join('  ·  ') || '⚡ ARCADE';
  document.getElementById('arcadeBar').style.display = 'block';
}

function addAuraToPiece(piece, colorInt) {
  removeAuraFromPiece(piece);
  const mat = new THREE.MeshBasicMaterial({ color:colorInt, transparent:true, opacity:0.18, side:THREE.FrontSide });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 8), mat);
  mesh.position.set(0, 0.3, 0);
  mesh.userData.isAura = true;
  piece.add(mesh);
  pieceAuras.set(piece, mesh);
}
function removeAuraFromPiece(piece) {
  const a = pieceAuras.get(piece);
  if (a) { piece.remove(a); pieceAuras.delete(piece); }
}

/* ================================================================
   ORB SYSTEM
================================================================ */
function randomOrbType() {
  const pool = ['power', 'gravity_tesseract'];
  if (arcadeSettings.laserMode !== 'off') pool.push('laser_instant');
  return pool[Math.floor(Math.random()*pool.length)];
}

function randomEmptySquare() {
  const emp = [];
  for (let x=0;x<8;x++) for (let y=0;y<8;y++) for (let z=0;z<LAYERS;z++) {
    if (!occ(x,y,z) && !isHole(x,y,z) && !activeOrbs.find(o=>o.x===x&&o.y===y&&o.z===z))
      emp.push({x,y,z});
  }
  return emp.length ? emp[Math.floor(Math.random()*emp.length)] : null;
}

function _tesseractProject(verts4d, edges4d, angle) {
  const cosA = Math.cos(angle),   sinA = Math.sin(angle);
  const cosB = Math.cos(angle*0.7), sinB = Math.sin(angle*0.7);
  const d4 = 2.5;
  const pts = new Float32Array(192);
  let idx = 0;
  edges4d.forEach(([vi, vj]) => {
    for (const vi2 of [vi, vj]) {
      const [vx,vy,vz,vw] = verts4d[vi2];
      const rx  = vx*cosA - vw*sinA,  rw1 = vx*sinA + vw*cosA;
      const ry  = vy*cosB - rw1*sinB, rw2 = vy*sinB + rw1*cosB;
      const f   = d4 / (d4 - rw2);
      pts[idx++] = rx*f; pts[idx++] = ry*f; pts[idx++] = vz*f;
    }
  });
  return pts;
}

function createTesseractOrbGroup(x, y, z) {
  const color = 0xBB70FF; // bright vibrant purple
  // Primary wireframe — bright core
  const mat = new THREE.LineBasicMaterial({color:0xddaaff, transparent:true, opacity:1.0});
  const s4 = 0.28;
  const cubeCorners = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const verts4d = [];
  cubeCorners.forEach(([cx,cy,cz]) => verts4d.push([cx*s4, cy*s4, cz*s4, +s4]));
  cubeCorners.forEach(([cx,cy,cz]) => verts4d.push([cx*s4, cy*s4, cz*s4, -s4]));
  const cubeEdges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const edges4d = [];
  cubeEdges.forEach(([a,b]) => edges4d.push([a, b]));
  cubeEdges.forEach(([a,b]) => edges4d.push([a+8, b+8]));
  for (let i=0;i<8;i++) edges4d.push([i, i+8]);
  // Core wireframe
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(_tesseractProject(verts4d, edges4d, 0), 3));
  const lines = new THREE.LineSegments(geo, mat);
  // Second wireframe slightly larger for thickness effect
  const mat2 = new THREE.LineBasicMaterial({color:0x7B2FBE, transparent:true, opacity:0.5});
  const geo2 = new THREE.BufferGeometry();
  geo2.setAttribute('position', new THREE.Float32BufferAttribute(_tesseractProject(verts4d, edges4d, 0), 3));
  const lines2 = new THREE.LineSegments(geo2, mat2);
  lines2.scale.set(1.15, 1.15, 1.15);
  const group = new THREE.Group();
  group.add(lines);
  group.add(lines2);
  // Large soft outer glow — additive blended sprite (nebula haze)
  var glowMat = new THREE.SpriteMaterial({
    map: _glowTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0.7, color: 0x9B4FDE
  });
  var glowSprite = new THREE.Sprite(glowMat);
  glowSprite.scale.set(2.0, 2.0, 2.0);
  group.add(glowSprite);
  // Inner bright core glow — smaller, hotter
  var coreMat = new THREE.SpriteMaterial({
    map: _glowTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0.5, color: 0xddaaff
  });
  var coreSprite = new THREE.Sprite(coreMat);
  coreSprite.scale.set(0.9, 0.9, 0.9);
  group.add(coreSprite);
  // No orbiting particles — they create visual noise that looks like faces
  group._verts4d = verts4d;
  group._edges4d = edges4d;
  group._lines2 = lines2; // reference for animation sync
  group.position.set(-half+(x+0.5)*SPACING, layers[z].position.y+0.45, -half+(y+0.5)*SPACING);
  pivot.add(group);
  return group;
}

function createLaserOrbGroup(x, y, z) {
  const group=new THREE.Group();
  const shardMat=new THREE.MeshBasicMaterial({color:0xff1111,transparent:true,opacity:0.92});
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.06,0.52,0.06),shardMat));
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.52,0.06,0.06),shardMat.clone()));
  const glowMat=new THREE.MeshBasicMaterial({color:0xff4400,transparent:true,opacity:0.35,wireframe:true});
  group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.22),glowMat));
  group.position.set(-half+(x+0.5)*SPACING, layers[z].position.y+0.45, -half+(y+0.5)*SPACING);
  pivot.add(group);
  return group;
}

function createOrbMesh(type, x, y, z) {
  if (type==='gravity_tesseract') return createTesseractOrbGroup(x,y,z);
  if (type==='laser_instant')     return createLaserOrbGroup(x,y,z);
  const def = ORB_DEFS[type];
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 9, 9),
    new THREE.MeshBasicMaterial({ color:def.color, transparent:true, opacity:0.85 })
  );
  // Wireframe halo
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 8, 8),
    new THREE.MeshBasicMaterial({ color:def.color, transparent:true, opacity:0.18, wireframe:true })
  );
  mesh.add(halo);
  mesh.position.set(-half+(x+0.5)*SPACING, layers[z].position.y+0.5, -half+(y+0.5)*SPACING);
  pivot.add(mesh);
  return mesh;
}

function spawnOrb(forceType) {
  const sq = randomEmptySquare(); if (!sq) return;
  const type = forceType || randomOrbType(); if (!type) return;
  const mesh = createOrbMesh(type, sq.x, sq.y, sq.z);
  const entry = { ...sq, type, mesh, t: Math.random()*Math.PI*2 };
  if (mesh._edges4d) { entry._edges4d = mesh._edges4d; entry._verts4d = mesh._verts4d; }
  activeOrbs.push(entry);
  arcadeAnnounce(ORB_DEFS[type].label + ' → L' + (sq.z+1), ORB_DEFS[type].color);
  arcadeLogEntry('⬡ '+ORB_DEFS[type].label+' at '+squareName(sq.x,sq.y,sq.z), '#'+ORB_DEFS[type].color.toString(16).padStart(6,'0'));
}

function removeOrbAt(x, y, z) {
  const i = activeOrbs.findIndex(o=>o.x===x&&o.y===y&&o.z===z);
  if (i===-1) return null;
  pivot.remove(activeOrbs[i].mesh);
  return activeOrbs.splice(i,1)[0];
}

function applyOrbEffect(piece, orbType, orbX, orbY, orbZ) {
  const col = piece.userData.color;
  const opp = col==='white'?'black':'white';

  if (orbType==='gravity_tesseract') {
    const ox = orbX ?? piece.userData.x;
    const oy = orbY ?? piece.userData.y;
    const oz = orbZ ?? piece.userData.z;
    // Delay so the capturing piece's move animation finishes before the gravity slide starts.
    // animateSlide(speed=0.05) takes ~330ms; 400ms clears it with margin.
    setTimeout(()=>evGravityTesseract(ox, oy, oz, piece), 400);
    return;
  }
  if (orbType==='laser_instant') {
    if (arcadeSettings.laserMode !== 'off') evLaserInstant(); return;
  }
  if (orbType==='power') {
    const PIECE_POWER = { king:'king_orb', knight:'phantom_knight', bishop:'warp_bishop', rook:'siege_rook', queen:'goddess' };
    if (piece.userData.type === 'pawn') {
      // Force promotion window wherever the pawn is
      turn = col; // pre-flip so resolvePromotion's flip gives the turn to opponent
      promotionGroup.userData.pawn = piece;
      promotionActive = true;
      if (typeof botColor !== 'undefined' && piece.userData.color === botColor) {
        setTimeout(() => { if (promotionActive) resolvePromotion('queen'); }, 400);
      } else {
        var _pp = document.getElementById('promotionPopup');
        if (_pp) _pp.style.display = 'flex';
      }
      arcadeAnnounce('⭐ POWER ORB — PROMOTE!', 0xff9900);
      arcadeLogEntry('  ⭐ '+col+' pawn power-promoted', '#ffaa00');
    } else {
      const pw = PIECE_POWER[piece.userData.type];
      if (pw) { piece.userData.power = pw; addAuraToPiece(piece, 0xff9900); }
      arcadeAnnounce('⚡ '+col.toUpperCase()+' '+piece.userData.type.toUpperCase()+' POWERED!', 0xff9900);
      arcadeLogEntry('  ⚡ '+col+' '+piece.userData.type+' → '+pw.replace(/_/g,' '), '#ffaa00');
    }
    return;
  }

}

/* ================================================================
   POWERED PIECE MOVE GENERATION
================================================================ */

/* ── Warp Bishop: diagonals with edge + layer wrap ── */
function getWarpBishopMoves(p) {
  // Phantom bishop: 3D diagonals, passes through friendly pieces, stops at enemy capture
  const moves = [], seen = new Set();
  const dirs = [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,1,1],[1,-1,1],[-1,1,1],[-1,-1,1],[1,1,-1],[1,-1,-1],[-1,1,-1],[-1,-1,-1]];
  for (const [dx,dy,dz] of dirs) {
    let cx=p.userData.x, cy=p.userData.y, cz=p.userData.z;
    for (let s=0; s<16; s++) {
      cx+=dx; cy+=dy; cz+=dz;
      if (cx<0||cx>7||cy<0||cy>7||cz<0||cz>=LAYERS) break;
      if (isHole(cx,cy,cz)) break;
      const k=key(cx,cy,cz); if (seen.has(k)) break; seen.add(k);
      const t=occ(cx,cy,cz);
      if (!t || t.userData.color===p.userData.color) {
        moves.push({x:cx,y:cy,z:cz});
      } else {
        moves.push({x:cx,y:cy,z:cz}); break; // capture and stop
      }
    }
  }
  return moves;
}

/* ── Phantom Knight: L-shape in xy, any dz ── */
function getPhantomKnightMoves(p) {
  const moves = [], {x,y,z} = p.userData;
  const xy = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
  for (const [dx,dy] of xy) {
    for (let dz=-7; dz<=7; dz++) {
      const tx=x+dx, ty=y+dy, tz=z+dz;
      if (tx<0||tx>7||ty<0||ty>7||tz<0||tz>=LAYERS) continue;
      const t = occ(tx,ty,tz);
      if (!t||t.userData.color!==p.userData.color) moves.push({x:tx,y:ty,z:tz});
    }
  }
  return moves;
}

/* ── Goddess: Queen + Bishop 3D diagonals + Knight ── */
function getGoddessMoves(p) {
  const seen = new Set(), add = m => { const k=key(m.x,m.y,m.z); if(!seen.has(k)){seen.add(k); moves.push(m);} };
  const moves = [];
  getQueenMoves(p).forEach(add);
  getBishopMoves(p).forEach(add);  // full 3D diagonals
  getKnightMoves(p).forEach(add);
  return moves;
}

/* ── Champion Pawn: always 2-square advance + forward captures ── */
function getChampionPawnMoves(p) {
  const moves = [], dir=p.userData.color==='white'?1:-1, {x,y,z}=p.userData;
  const f1=y+dir, f2=y+dir*2;
  if (f1>=0&&f1<8) {
    const atF1 = occ(x,f1,z);
    if (!atF1) {
      moves.push({x,y:f1,z});                           // 1-step forward
      if (f2>=0&&f2<8&&!occ(x,f2,z)) moves.push({x,y:f2,z}); // always 2-step
    } else if (atF1.userData.color!==p.userData.color) {
      moves.push({x,y:f1,z});                           // forward capture (champion perk)
    }
  }
  // Layer forward
  const u1=z+dir;
  if (u1>=0&&u1<LAYERS&&!occ(x,y,u1)) moves.push({x,y,z:u1});
  // Diagonal captures
  [[1,dir],[-1,dir]].forEach(([dx,dy])=>{ const tx=x+dx,ty=y+dy; if(ty>=0&&ty<8){const t=occ(tx,ty,z);if(t&&t.userData.color!==p.userData.color)moves.push({x:tx,y:ty,z});}});
  [[1,dir],[-1,dir]].forEach(([dx,dz])=>{ const tx=x+dx,tz=z+dz; if(tz>=0&&tz<LAYERS){const t=occ(tx,y,tz);if(t&&t.userData.color!==p.userData.color)moves.push({x:tx,y,z:tz});}});
  return moves;
}

/* ── Route powered moves ── */
const _arcadeBasePseudo = getPseudoMoves;
function getArcadeMoves(p) {
  const pw = p.userData.power;
  if (pw==='warp_bishop')    return getWarpBishopMoves(p);
  if (pw==='phantom_knight') return getPhantomKnightMoves(p);
  if (pw==='goddess')        return getGoddessMoves(p);
  if (pw==='siege_rook')     return getRookMoves(p);    // push handled in executeMove
  if (pw==='champion_pawn')  return getChampionPawnMoves(p);
  if (pw==='king_orb')       return getKingMoves(p);    // same moves; double-move in executeMove
  return _arcadeBasePseudo(p);
}

/* ── Patch getPseudoMoves ── */
getPseudoMoves = function(p) {
  let moves = (arcadeSettings.enabled && p.userData.power)
    ? getArcadeMoves(p)
    : _arcadeBasePseudo(p);

  if (!arcadeSettings.enabled) return moves;
  // Filter hole squares
  if (holeSquares.size) moves = moves.filter(m=>!isHole(m.x,m.y,m.z));
  return moves;
};

/* ── Patch getLegalMoves: restrict to double-moving king ── */
const _arcadeBaseLegal = getLegalMoves;
getLegalMoves = function(piece) {
  // During king double-move, only the double-moving king may act
  if (arcadeSettings.enabled && arcadeDblPending && piece!==arcadeDblPiece) return [];
  return _arcadeBaseLegal(piece);
};

/* ── Patch botMove: suppress during double-move / extra-turn hold ── */
const _arcadeBaseBotMove = botMove;
botMove = function() {
  if (arcadeSettings.enabled && arcadeDblPending) return;
  _arcadeBaseBotMove();
};

/* ================================================================
   EXECUTE MOVE WRAPPER
================================================================ */
const _arcadeBaseExecMove = executeMove;  // already includes puzzle wrapper
executeMove = function(piece, t) {
  if (!arcadeSettings.enabled || PUZZLE_MODE) {
    _arcadeBaseExecMove.call(this, piece, t);
    return;
  }

  // Enforce double-move restriction
  if (arcadeDblPending && piece!==arcadeDblPiece) {
    arcadeAnnounce('👑 King must move again!', 0xffd700);
    return;
  }

  // ── Siege Rook push ──
  if (piece.userData.power==='siege_rook') {
    const victim = occ(t.x,t.y,t.z);
    if (victim && victim.userData.color!==piece.userData.color) {
      const dx=Math.sign(t.x-piece.userData.x), dy=Math.sign(t.y-piece.userData.y), dz=Math.sign(t.z-piece.userData.z);
      const px=t.x+dx, py=t.y+dy, pz=t.z+dz;
      if (px>=0&&px<8&&py>=0&&py<8&&pz>=0&&pz<LAYERS&&!occ(px,py,pz)) {
        delete boardMap[key(victim.userData.x,victim.userData.y,victim.userData.z)];
        const from2={x:victim.userData.x,y:victim.userData.y,z:victim.userData.z};
        victim.userData.x=px; victim.userData.y=py; victim.userData.z=pz;
        boardMap[key(px,py,pz)]=victim;
        animateSlide(victim,from2,{x:px,y:py,z:pz},0.07);
        arcadeAnnounce('⚔ SIEGE ROOK — Enemy pushed!', 0xff4400);
        // Target square now empty; base executeMove will move rook there without capture
      }
    }
  }

  // Snapshot state before base call
  const movingColor = piece.userData.color;
  const isKingOrb   = (piece.userData.power==='king_orb' && piece.userData.type==='king');
  const movedPiece  = piece;
  const wasDouble   = arcadeDblPending;

  // Capture orb at destination before base move (base move may place piece there)
  const orbHere = activeOrbs.find(o=>o.x===t.x&&o.y===t.y&&o.z===t.z);

  // ── Execute base move ──
  _arcadeBaseExecMove.call(this, piece, t);

  // ── Absorb orb ──
  if (orbHere) {
    removeOrbAt(t.x, t.y, t.z);
    arcadeLogEntry('★ '+(ORB_DEFS[orbHere.type]?.label||orbHere.type)+' captured', '#ffdd44');
    applyOrbEffect(movedPiece, orbHere.type, t.x, t.y, t.z);
    SND.confirm();
  }

  // ── Champion pawn: auto-promote ──
  if (movedPiece.userData.power==='champion_pawn' && promotionActive) {
    setTimeout(()=>{ if(promotionActive) resolvePromotion('queen'); }, 3000);
  }

  // ── Post-move arcade turn logic ──
  arcadePostTurn(movingColor, isKingOrb, wasDouble, movedPiece);
};

/* ── Post-move turn management ── */
function arcadePostTurn(movingColor, isKingOrb, wasDouble, movedPiece) {
  arcadeTurnCount++;

  // ── King double-move: first move ──
  if (isKingOrb && !wasDouble) {
    arcadeDblPending = true;
    arcadeDblColor   = movingColor;
    arcadeDblPiece   = movedPiece;
    // Flip turn back so same player acts again
    turn = movingColor;
    document.getElementById('hud').textContent = movingColor.charAt(0).toUpperCase()+movingColor.slice(1)+' — MOVE AGAIN (King Orb)';
    arcadeAnnounce('👑 KING ORB — Move the king again!', 0xffd700);
    updateArcadeBar(); return;
  }

  // ── King double-move: second move completes ──
  if (wasDouble) {
    arcadeDblPending = false; arcadeDblColor = null; arcadeDblPiece = null;
    // Fall through to normal post-move processing
  }

  // ── Orb spawning ──
  if (arcadeTurnCount >= nextOrbSpawn) {
    spawnOrb();
    nextOrbSpawn = arcadeTurnCount + (SPAWN_INTERVALS[arcadeSettings.spawnRate]||4);
  }

  // ── Random events ──
  if (arcadeSettings.randomEvents && arcadeTurnCount >= nextEventTurn) {
    setTimeout(()=>triggerRandomEvent(), 1400);
    nextEventTurn = arcadeTurnCount + 8 + Math.floor(Math.random()*6);
  }

  // ── Tick temporary effects ──
  tickLaserWarning(); tickRegen(); tickCompact();
  updateArcadeBar();
}

