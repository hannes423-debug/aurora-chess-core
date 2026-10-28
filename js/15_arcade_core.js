/* ================================================================
   ARCADE INIT / RESET
================================================================ */
function resetArcadeState() {
  activeOrbs.forEach(o=>pivot.remove(o.mesh)); activeOrbs.length=0;
  if (laserWarning) { laserWarning.warningMeshes.forEach(m=>{ if(m.parent) m.parent.remove(m); }); laserWarning=null; }
  clearAllHoles();
  layers.forEach((l,i)=>{ l.position.y=(i-LAYERS/2)*LAYER_SPACING; });
  boardW=8; boardH=8; boardD=LAYERS;
  arcadeDblPending=false; arcadeDblColor=null; arcadeDblPiece=null;
  pieces.forEach(p=>{ removeAuraFromPiece(p); delete p.userData.power; });
  arcadeTurnCount=0;
  nextOrbSpawn=3;
  nextEventTurn=8+Math.floor(Math.random()*5);
  document.getElementById('arcadeBar').style.display='none';
  document.getElementById('arcadeEventBanner').style.display='none';
  arcadeActive=false;
  // Note: arcadeSettings.enabled is NOT reset here — it's controlled by menu selection
}

/* ── Patch startLocalGame to init arcade ── */
const _arcadeBaseStartLocal = startLocalGame;
startLocalGame = function() {
  setGameInputEnabled(true);
  resetArcadeState();
  _arcadeBaseStartLocal();
  arcadeActive = arcadeSettings.enabled;
  if (arcadeActive) {
    updateArcadeBar();
    // Seed with 2 orbs after pieces settle
    setTimeout(()=>{ spawnOrb(); spawnOrb(); }, 1200);
  }
};

/* ================================================================
   ARCADE RENDER LOOP (orb bob + aura pulse)
================================================================ */
(function arcadeAnimLoop() {
  requestAnimationFrame(arcadeAnimLoop);
  if (!arcadeActive) return;
  const t = performance.now() * 0.001;
  // Orbs bob and pulse
  activeOrbs.forEach(o => {
    if (o.type==='gravity_tesseract') {
      o.mesh.position.y = layers[o.z].position.y + 0.45 + Math.sin(t*1.4+o.t)*0.08;
      const edges = o._edges4d, verts = o._verts4d;
      const lines = o.mesh.children[0];
      const lines2 = o.mesh._lines2 || o.mesh.children[1];
      if (!edges || !verts || !lines) { o.mesh.rotation.y += 0.019; return; }
      o._angle4d = (o._angle4d||0) + 0.015;
      const a = o._angle4d;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const cosB = Math.cos(a*0.7), sinB = Math.sin(a*0.7);
      const d4 = 2.5;
      const arr = lines.geometry.attributes.position.array;
      let idx = 0;
      edges.forEach(([vi, vj]) => {
        for (const vi2 of [vi, vj]) {
          const [vx,vy,vz,vw] = verts[vi2];
          const rx = vx*cosA - vw*sinA, rw1 = vx*sinA + vw*cosA;
          const ry = vy*cosB - rw1*sinB, rw2 = vy*sinB + rw1*cosB;
          const factor = d4 / (d4 - rw2);
          arr[idx++] = rx*factor; arr[idx++] = ry*factor; arr[idx++] = vz*factor;
        }
      });
      lines.geometry.attributes.position.needsUpdate = true;
      // Sync outer wireframe (thickness layer)
      if (lines2 && lines2.geometry) {
        const arr2 = lines2.geometry.attributes.position.array;
        for (let i = 0; i < arr.length; i++) arr2[i] = arr[i];
        lines2.geometry.attributes.position.needsUpdate = true;
      }
      // Pulse outer glow — children[2] after two wireframes
      const glowSprite = o.mesh.children[2];
      if (glowSprite && glowSprite.material) {
        glowSprite.material.opacity = 0.5 + Math.sin(t*1.8+o.t)*0.25;
        const gs = 1.8 + Math.sin(t*1.2)*0.2;
        glowSprite.scale.set(gs, gs, gs);
      }
      // Pulse inner core — children[3]
      const coreSprite = o.mesh.children[3];
      if (coreSprite && coreSprite.material) {
        coreSprite.material.opacity = 0.35 + Math.sin(t*3+o.t)*0.2;
      }
      return;
    }
    if (o.type==='laser_instant') {
      o.mesh.position.y = layers[o.z].position.y + 0.45 + Math.sin(t*2.5+o.t)*0.1;
      o.mesh.rotation.y += 0.055; return;
    }
    o.mesh.position.y = layers[o.z].position.y + 0.45 + Math.sin(t*1.8 + o.t)*0.12;
    o.mesh.material.opacity = 0.6 + Math.sin(t*2.2 + o.t)*0.25;
    if (o.mesh.children[0]) {
      o.mesh.children[0].rotation.y += 0.04;
      o.mesh.children[0].material.opacity = 0.1 + Math.sin(t*3)*0.08;
    }
  });
  // Piece auras
  pieces.forEach(p => {
    const a = pieceAuras.get(p);
    if (a) { a.material.opacity=0.1+Math.sin(t*2+p.userData.x)*0.08; a.rotation.y+=0.025; }
  });
  // Laser warning pulse
  if (laserWarning) laserWarning.warningMeshes.forEach(g=>{
    const m = g._warningPlane;
    if(m) m.material.opacity=0.3+Math.abs(Math.sin(t*4))*0.55;
  });
})();

/* ================================================================
   ARCADE MENU UI WIRING
================================================================ */
function updateArcadeMenuUI() {
  // Feature toggles
  document.querySelectorAll('[data-arc]').forEach(btn=>{
    const k = btn.dataset.arc;
    btn.textContent = arcadeSettings[k] ? 'ON' : 'OFF';
    btn.className   = 'arcadeToggleBtn ' + (arcadeSettings[k] ? 'on' : 'off');
  });
  // Orb spawn rate
  document.querySelectorAll('[data-rate]').forEach(btn=>{
    btn.className = 'arcadeRateBtn' + (btn.dataset.rate===arcadeSettings.spawnRate ? ' active' : '');
  });
  // Laser mode
  document.querySelectorAll('[data-laser]').forEach(btn=>{
    btn.className = 'arcadeRateBtn' + (btn.dataset.laser===arcadeSettings.laserMode ? ' active' : '');
  });
  // Regen interval
  document.querySelectorAll('[data-regen]').forEach(btn=>{
    btn.className = 'arcadeRateBtn' + (btn.dataset.regen===arcadeSettings.regenInterval ? ' active' : '');
  });
  // Regen chance
  document.querySelectorAll('[data-regchance]').forEach(btn=>{
    btn.className = 'arcadeRateBtn' + (btn.dataset.regchance===arcadeSettings.regenChance ? ' active' : '');
  });
  // Compact interval
  document.querySelectorAll('[data-compact]').forEach(btn=>{
    btn.className = 'arcadeRateBtn' + (btn.dataset.compact===arcadeSettings.compactInterval ? ' active' : '');
  });
}

// arcadeMasterToggle removed — arcade is always enabled when entering from Game Modes menu
document.querySelectorAll('[data-arc]').forEach(btn=>{
  btn.onclick = () => {
    if (!arcadeSettings.enabled) return;
    arcadeSettings[btn.dataset.arc] = !arcadeSettings[btn.dataset.arc];
    SND.ui(); updateArcadeMenuUI();
  };
});
document.querySelectorAll('[data-rate]').forEach(btn=>{
  btn.onclick = () => {
    arcadeSettings.spawnRate = btn.dataset.rate;
    SND.ui(); updateArcadeMenuUI();
  };
});
document.querySelectorAll('[data-laser]').forEach(btn=>{
  btn.onclick = () => {
    arcadeSettings.laserMode = btn.dataset.laser;
    SND.ui(); updateArcadeMenuUI();
  };
});
document.querySelectorAll('[data-regen]').forEach(btn=>{
  btn.onclick = () => {
    arcadeSettings.regenInterval = btn.dataset.regen;
    SND.ui(); updateArcadeMenuUI();
  };
});
document.querySelectorAll('[data-regchance]').forEach(btn=>{
  btn.onclick = () => {
    arcadeSettings.regenChance = btn.dataset.regchance;
    SND.ui(); updateArcadeMenuUI();
  };
});
document.querySelectorAll('[data-compact]').forEach(btn=>{
  btn.onclick = () => {
    arcadeSettings.compactInterval = btn.dataset.compact;
    SND.ui(); updateArcadeMenuUI();
  };
});

document.getElementById('openArcadeBtn').onclick = () => {
  SND.confirm();
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('arcadeMenu').style.display = 'flex';
  updateArcadeMenuUI();
};
document.getElementById('arcadeBackBtn').onclick = () => {
  SND.ui();
  document.getElementById('arcadeMenu').style.display = 'none';
  document.getElementById('gameModesMenu').style.display = 'flex';
};
document.getElementById('arcadePlayBtn').onclick = () => {
  SND.confirm();
  document.getElementById('arcadeMenu').style.display = 'none';
  arcadeSettings.enabled = true;
  document.getElementById('modeMenu').style.display = 'flex';
};

/* ================================================================
   STEP 3 ARCADE SETTINGS (ps3 prefix) — mirror controls
================================================================ */
// Accordion toggle
document.getElementById('ps3ArcadeHeader').onclick = () => {
  const content = document.getElementById('ps3ArcadeContent');
  const arrow = document.getElementById('ps3ArcadeArrow');
  const open = content.style.display === 'none';
  content.style.display = open ? 'block' : 'none';
  arrow.style.transform = open ? 'rotate(180deg)' : '';
  SND.ui();
};

// Sync ps3 buttons to match arcadeSettings state
function updatePs3ArcadeUI() {
  document.querySelectorAll('[data-ps3arc]').forEach(btn => {
    const k = btn.dataset.ps3arc;
    btn.textContent = arcadeSettings[k] ? 'ON' : 'OFF';
    btn.className = 'arcadeToggleBtn ' + (arcadeSettings[k] ? 'on' : 'off');
  });
  document.querySelectorAll('[data-ps3rate]').forEach(btn => {
    btn.className = 'arcadeRateBtn' + (btn.dataset.ps3rate === arcadeSettings.spawnRate ? ' active' : '');
  });
  document.querySelectorAll('[data-ps3laser]').forEach(btn => {
    btn.className = 'arcadeRateBtn' + (btn.dataset.ps3laser === arcadeSettings.laserMode ? ' active' : '');
  });
  document.querySelectorAll('[data-ps3regen]').forEach(btn => {
    btn.className = 'arcadeRateBtn' + (btn.dataset.ps3regen === arcadeSettings.regenInterval ? ' active' : '');
  });
  document.querySelectorAll('[data-ps3regchance]').forEach(btn => {
    btn.className = 'arcadeRateBtn' + (btn.dataset.ps3regchance === arcadeSettings.regenChance ? ' active' : '');
  });
  document.querySelectorAll('[data-ps3compact]').forEach(btn => {
    btn.className = 'arcadeRateBtn' + (btn.dataset.ps3compact === arcadeSettings.compactInterval ? ' active' : '');
  });
}

// Toggle handlers
document.querySelectorAll('[data-ps3arc]').forEach(btn => {
  btn.onclick = () => {
    arcadeSettings[btn.dataset.ps3arc] = !arcadeSettings[btn.dataset.ps3arc];
    SND.ui(); updatePs3ArcadeUI(); updateArcadeMenuUI();
  };
});
document.querySelectorAll('[data-ps3rate]').forEach(btn => {
  btn.onclick = () => { arcadeSettings.spawnRate = btn.dataset.ps3rate; SND.ui(); updatePs3ArcadeUI(); updateArcadeMenuUI(); };
});
document.querySelectorAll('[data-ps3laser]').forEach(btn => {
  btn.onclick = () => { arcadeSettings.laserMode = btn.dataset.ps3laser; SND.ui(); updatePs3ArcadeUI(); updateArcadeMenuUI(); };
});
document.querySelectorAll('[data-ps3regen]').forEach(btn => {
  btn.onclick = () => { arcadeSettings.regenInterval = btn.dataset.ps3regen; SND.ui(); updatePs3ArcadeUI(); updateArcadeMenuUI(); };
});
document.querySelectorAll('[data-ps3regchance]').forEach(btn => {
  btn.onclick = () => { arcadeSettings.regenChance = btn.dataset.ps3regchance; SND.ui(); updatePs3ArcadeUI(); updateArcadeMenuUI(); };
});
document.querySelectorAll('[data-ps3compact]').forEach(btn => {
  btn.onclick = () => { arcadeSettings.compactInterval = btn.dataset.ps3compact; SND.ui(); updatePs3ArcadeUI(); updateArcadeMenuUI(); };
});

// Sync ps3 buttons on init and whenever ps3ArcadeSection becomes visible
updatePs3ArcadeUI();
new MutationObserver(() => {
  if (document.getElementById('ps3ArcadeSection').style.display !== 'none') updatePs3ArcadeUI();
}).observe(document.getElementById('ps3ArcadeSection'), { attributes: true, attributeFilter: ['style'] });
