/* ======================================================
   UI WIRING
====================================================== */
document.getElementById("menuBtn").onclick=()=>{SND.ui();HAP.vib('ui');const _pm=document.getElementById("pauseMenu");_pm.style.display="flex";if(typeof initMenuFocus==='function')initMenuFocus(_pm);};
document.getElementById("resumeBtn").onclick=()=>{SND.confirm();document.getElementById("pauseMenu").style.display="none";if(typeof updateMenuSelection==='function')updateMenuSelection();};
document.getElementById("pauseResignBtn").onclick=()=>{
  SND.confirm(); document.getElementById("pauseMenu").style.display="none";
  if(ONLINE.inMatch){
    onlineDCSend('resign');
    onlineRecordResult(ONLINE.myColor==='white'?'black_wins':'white_wins');
    endGame('You resigned.');
  } else {
    var loser=turn;
    endGame((loser==='white'?'Black':'White')+' wins by resignation');
  }
};
document.getElementById("pauseDrawBtn").onclick=()=>{
  SND.ui(); document.getElementById("pauseMenu").style.display="none";
  if(ONLINE.inMatch){
    if(ONLINE._drawOfferSent){onlineShowToast('Draw offer already pending.',0xffaa00);return;}
    ONLINE._drawOfferSent=true;
    onlineDCSend('draw_offer');
    onlineShowToast('Draw offered — waiting for opponent.',0xffaa00);
  } else {
    endGame('Draw agreed');
  }
};
document.getElementById("restartBtn").onclick=()=>{
  SND.confirm(); document.getElementById("pauseMenu").style.display="none";
  if(PUZZLE_MODE){const puzData=PUZZLE_TUT_KEY>=0?TUT_PUZZLES[PUZZLE_TUT_KEY]:PUZZLES[PUZZLE_ACTIVE];if(puzData){PUZZLE_MOVES_MADE=0;loadPuzzlePieces(puzData);document.getElementById('puzzleBarName').textContent=puzData.name.toUpperCase();document.getElementById('puzzleBarName').style.color='';document.getElementById('puzzleBarStatus').textContent=puzData.objective;var _rp=document.getElementById('puzzleInfoPopup');if(_rp){_rp.style.display='block';clearTimeout(window._puzzleInfoAutoHide);window._puzzleInfoAutoHide=setTimeout(()=>{if(_rp)_rp.style.display='none';},3500);}}}else{startLocalGame();}
};
function _doExit() {
  SND.confirm();
  document.getElementById("pauseMenu").style.display="none";
  document.getElementById("endMenu").style.display="none";
  setReviewing(false); onlineHideColorIndicator();
  localStorage.removeItem('cc_pending_match');
  if (ONLINE.inMatch) { onlineDCSend('resign'); onlineRecordResult(ONLINE.myColor==='white'?'black_wins':'white_wins'); }
  ONLINE.inMatch = false; ONLINE._drawOfferSent = false;
  botColor=null; exitPuzzleMode(); resetBoard(); turn="white";
  document.getElementById("hud").textContent="White to move";
  renderer.domElement.style.pointerEvents="none";
  var _rbtn=document.getElementById("rotateBoardBtn"); if(_rbtn)_rbtn.style.display="none";
  var _pbn=document.getElementById("panBoardBtn"); if(_pbn)_pbn.style.display="none";
  var _gear=document.getElementById("hudGearBtn"); if(_gear){_gear.style.display="none";var _qp=document.getElementById("hudQuickPanel");if(_qp)_qp.style.display="none";}
  const _mm=document.getElementById("mainMenu");_mm.style.display="flex";
  if(typeof initMenuFocus==='function')initMenuFocus(_mm);
}
document.getElementById("exitBtn").onclick=()=>{
  if (ONLINE.inMatch) {
    _onlineConfirm('Resign and exit? Your opponent wins.', _doExit);
  } else {
    _doExit();
  }
};
let _settingsOrigin = 'pauseMenu';
document.getElementById("settingsBtn").onclick=()=>{SND.ui();_settingsOrigin="pauseMenu";document.getElementById("pauseMenu").style.display="none";const _so=document.getElementById("settingsOverlay");_so.style.display="flex";if(typeof initMenuFocus==='function')initMenuFocus(_so);};
document.getElementById("closeSettings").onclick=()=>{
  SND.ui();
  // Close = cancel (restore snapshot)
  if(typeof restoreCFG === 'function') restoreCFG();
  document.getElementById("settingsOverlay").style.display="none";
  if(typeof _settingsOrigin !== 'undefined' && _settingsOrigin !== 'pauseMenu') {
    document.getElementById(_settingsOrigin).style.display='flex';
  }
  stopPiecePreview();
};
document.getElementById("settingsOverlay").addEventListener("click",e=>{if(e.target===document.getElementById("settingsOverlay")){SND.ui();if(typeof restoreCFG==='function')restoreCFG();document.getElementById("settingsOverlay").style.display="none";if(typeof _settingsOrigin!=='undefined'&&_settingsOrigin!=='pauseMenu'){document.getElementById(_settingsOrigin).style.display='flex';}stopPiecePreview();}});

// ── Top-level settings tabs: BASIC | MORE ▾ ──
document.querySelectorAll(".stTab").forEach(btn => {
  btn.onclick = () => {
    SND.ui();
    document.querySelectorAll(".stTab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".settingPage").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const page = document.getElementById(btn.dataset.page);
    if (page) page.classList.add("active");
    // For BASIC tab show piece preview; for MORE show current advPage
    if (btn.dataset.page === 'pageBasic') {
      drawSettingsPreview('pagePieces');
    } else {
      const activeAdv = document.querySelector('.advTab.active');
      drawSettingsPreview(activeAdv ? activeAdv.dataset.adv : 'pagePieces');
    }
  };
});

// ── Advanced sub-tabs ──
document.querySelectorAll(".advTab").forEach(btn => {
  btn.onclick = () => {
    SND.ui();
    document.querySelectorAll(".advTab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".advPage").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const page = document.getElementById(btn.dataset.adv);
    if (page) page.classList.add("active");
    drawSettingsPreview(btn.dataset.adv);
  };
});
// Legacy settingNavBtn compat (hidden but still wired for preset code)
document.querySelectorAll(".settingNavBtn").forEach(btn=>{btn.onclick=()=>{};});

function wireToggle(id,cfgRef,key2){document.getElementById(id).addEventListener("change",e=>{cfgRef[key2]=e.target.checked;refreshLegalMoveHighlights();refreshThreatHighlights();refreshLastMove();});}
function wireColor(id,cfgRef,key2,refreshFn){document.getElementById(id).addEventListener("input",e=>{cfgRef[key2]=hexToInt(e.target.value);refreshFn();});}
function wireOpacity(id,cfgRef,key2,refreshFn){document.getElementById(id).addEventListener("input",e=>{cfgRef[key2]=parseInt(e.target.value)/100;refreshFn();});}
wireToggle("hlLegal",CFG.hl.legal,"on");wireColor("hlLegalColor",CFG.hl.legal,"color",refreshLegalMoveHighlights);wireOpacity("hlLegalOpacity",CFG.hl.legal,"opacity",refreshLegalMoveHighlights);
wireToggle("hlThreats",CFG.hl.threats,"on");wireColor("hlThreatsColor",CFG.hl.threats,"color",refreshThreatHighlights);wireOpacity("hlThreatsOpacity",CFG.hl.threats,"opacity",refreshThreatHighlights);
wireToggle("hlLastMove",CFG.hl.lastMove,"on");wireColor("hlLastMoveColor",CFG.hl.lastMove,"color",refreshLastMove);wireOpacity("hlLastMoveOpacity",CFG.hl.lastMove,"opacity",refreshLastMove);
wireToggle("hlSelection",CFG.hl.selection,"on");wireColor("hlSelectionColor",CFG.hl.selection,"color",()=>{});wireOpacity("hlSelectionOpacity",CFG.hl.selection,"opacity",()=>{});

// Add live preview refresh for HL changes
['hlLegal','hlThreats','hlLastMove','hlSelection'].forEach(id => {
  const el = document.getElementById(id); if (el) el.addEventListener('change', () => draw2dPreview('pageHighlights'));
});
['hlLegalColor','hlThreatsColor','hlLastMoveColor','hlSelectionColor',
 'hlLegalOpacity','hlThreatsOpacity','hlLastMoveOpacity','hlSelectionOpacity'].forEach(id => {
  const el = document.getElementById(id); if (el) el.addEventListener('input', () => draw2dPreview('pageHighlights'));
});

document.getElementById("gridActiveColor").addEventListener("input",e=>{CFG.grid.activeColor=hexToInt(e.target.value);update();draw2dPreview('pageBoard');});
document.getElementById("gridActiveOpacity").addEventListener("input",e=>{CFG.grid.activeOpacity=parseInt(e.target.value)/100;update();draw2dPreview('pageBoard');});
document.getElementById("gridDimColor").addEventListener("input",e=>{CFG.grid.dimColor=hexToInt(e.target.value);update();draw2dPreview('pageBoard');});
document.getElementById("gridDimOpacity").addEventListener("input",e=>{CFG.grid.dimOpacity=parseInt(e.target.value)/100;update();draw2dPreview('pageBoard');});
document.getElementById("gridThickness").addEventListener("input",e=>{CFG.grid.thickness=parseFloat(e.target.value);update();draw2dPreview('pageBoard');});
document.getElementById("cgActiveOpacity").addEventListener("input",e=>{CFG.cosmicGlass.activeOpacity=parseInt(e.target.value)/100;if(cosmicGlassActive)_updateCgSlabActivity();});
document.getElementById("cgDimOpacity").addEventListener("input",e=>{CFG.cosmicGlass.dimOpacity=parseInt(e.target.value)/100;if(cosmicGlassActive)_updateCgSlabActivity();});
document.getElementById("bgColor").addEventListener("input",e=>{
  BG.color=e.target.value;
  // sync basic tab color picker
  const bBg = document.getElementById('bBgColor'); if(bBg) bBg.value = e.target.value;
  renderer.setClearColor(0,0);
  document.body.style.background=e.target.value;
  draw2dPreview('pageBackground');
});
document.getElementById("bgStarColor").addEventListener("input",e=>{
  BG.starColor=e.target.value;
  const b=document.getElementById('bBgStarColor'); if(b) b.value=e.target.value;
  saveBGColors();
});
document.getElementById("bgNebulaColor").addEventListener("input",e=>{
  BG.nebulaAccentColor=e.target.value;
  const b=document.getElementById('bBgNebulaColor'); if(b) b.value=e.target.value;
  saveBGColors();
});
(function(){
  const bsc=document.getElementById('bBgStarColor');
  if(bsc) bsc.addEventListener('input',e=>{
    BG.starColor=e.target.value;
    const a=document.getElementById('bgStarColor'); if(a) a.value=e.target.value;
    saveBGColors();
  });
  const bnc=document.getElementById('bBgNebulaColor');
  if(bnc) bnc.addEventListener('input',e=>{
    BG.nebulaAccentColor=e.target.value;
    const a=document.getElementById('bgNebulaColor'); if(a) a.value=e.target.value;
    saveBGColors();
  });
})();

document.getElementById("whitePieceColor").addEventListener("input",e=>{CFG.pieces.white.color=hexToInt(e.target.value);applyPieceColors();});
document.getElementById("whiteOutlineColor").addEventListener("input",e=>{CFG.pieces.white.outlineColor=hexToInt(e.target.value);pieces.forEach(p=>{if(p.userData.color==='white'&&p!==selectedPawn)setOutlineColor(p,CFG.pieces.white.outlineColor);});});
document.getElementById("whiteOutlineSelColor").addEventListener("input",e=>{CFG.pieces.white.outlineSelColor=hexToInt(e.target.value);if(selectedPawn&&selectedPawn.userData.color==='white')setOutlineColor(selectedPawn,CFG.pieces.white.outlineSelColor);});
document.getElementById("whiteOutlineThickness").addEventListener("input",e=>{CFG.pieces.white.thickness=parseInt(e.target.value)/100;pieces.forEach(p=>{if(p.userData.color==='white')setOutlineThickness(p,CFG.pieces.white.thickness);});});
document.getElementById("blackPieceColor").addEventListener("input",e=>{CFG.pieces.black.color=hexToInt(e.target.value);applyPieceColors();});
document.getElementById("blackOutlineColor").addEventListener("input",e=>{CFG.pieces.black.outlineColor=hexToInt(e.target.value);pieces.forEach(p=>{if(p.userData.color==='black'&&p!==selectedPawn)setOutlineColor(p,CFG.pieces.black.outlineColor);});});
document.getElementById("blackOutlineSelColor").addEventListener("input",e=>{CFG.pieces.black.outlineSelColor=hexToInt(e.target.value);if(selectedPawn&&selectedPawn.userData.color==='black')setOutlineColor(selectedPawn,CFG.pieces.black.outlineSelColor);});
document.getElementById("blackOutlineThickness").addEventListener("input",e=>{CFG.pieces.black.thickness=parseInt(e.target.value)/100;pieces.forEach(p=>{if(p.userData.color==='black')setOutlineThickness(p,CFG.pieces.black.thickness);});});

document.querySelectorAll("[data-preset]").forEach(btn=>{btn.onclick=()=>{SND.ui();applyPieceOnlyPreset(btn.dataset.preset);};});

document.querySelectorAll("[data-bg]").forEach(btn=>{btn.onclick=()=>{SND.ui();BG.apply(btn.dataset.bg);draw2dPreview('pageBackground');};});
document.getElementById("bgUpload").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = document.getElementById("bgPhoto");
    img.src = ev.target.result;
    img.style.display = 'block';
  };
  reader.readAsDataURL(file);
});
document.getElementById("bgPhotoOpacity").addEventListener("input",e=>{
  var op=parseInt(e.target.value)/100;
  document.getElementById("bgPhoto").style.opacity=op;
  var adv=document.getElementById('bgPhotoOpacityAdv');if(adv)adv.value=e.target.value;
});
(function(){
  var advOp=document.getElementById('bgPhotoOpacityAdv');
  if(!advOp)return;
  advOp.addEventListener('input',function(e){
    document.getElementById('bgPhoto').style.opacity=parseInt(e.target.value)/100;
    var basic=document.getElementById('bgPhotoOpacity');if(basic)basic.value=e.target.value;
  });
})();

document.querySelectorAll("[data-msgkey]").forEach(btn=>{
  btn.onclick=()=>{
    activeMsgKey=btn.dataset.msgkey;
    document.querySelectorAll("[data-msgkey]").forEach(b=>b.classList.toggle("active",b.dataset.msgkey===activeMsgKey));
    syncMsgUI();
    draw2dPreview('pageMessages');
  };
});
document.getElementById("msgText").addEventListener("input",e=>{MSGS[activeMsgKey].text=e.target.value;draw2dPreview('pageMessages');});
document.getElementById("msgColor").addEventListener("input",e=>{MSGS[activeMsgKey].color=e.target.value;draw2dPreview('pageMessages');});
document.getElementById("msgSize").addEventListener("input",e=>{MSGS[activeMsgKey].size=parseInt(e.target.value);draw2dPreview('pageMessages');});
document.getElementById("msgDur").addEventListener("input",e=>{MSGS[activeMsgKey].dur=parseInt(e.target.value);});
document.getElementById("msgGlow").addEventListener("change",e=>{MSGS[activeMsgKey].glow=e.target.checked;draw2dPreview('pageMessages');});
document.querySelectorAll("[data-msganim]").forEach(btn=>{btn.onclick=()=>{MSGS[activeMsgKey].anim=btn.dataset.msganim;document.querySelectorAll("[data-msganim]").forEach(b=>b.classList.toggle("active",b.dataset.msganim===MSGS[activeMsgKey].anim));draw2dPreview('pageMessages');};});
document.querySelectorAll("[data-msglayer]").forEach(btn=>{btn.onclick=()=>{MSGS[activeMsgKey].layer=btn.dataset.msglayer;document.querySelectorAll("[data-msglayer]").forEach(b=>b.classList.toggle("active",b.dataset.msglayer===String(MSGS[activeMsgKey].layer)));};});
document.getElementById("msgPreview").onclick=()=>{SND.ui();showBoardMsg(activeMsgKey);};

document.getElementById("soundOn").addEventListener("change",e=>{SND.on=e.target.checked;draw2dPreview('pageSound');});
document.getElementById("masterVolume").addEventListener("input",e=>{SND.vol=parseInt(e.target.value)/100;draw2dPreview('pageSound');});
document.getElementById("hapticOn").addEventListener("change",e=>{HAP.on=e.target.checked;});
document.querySelectorAll("[data-haptic]").forEach(btn=>{btn.onclick=()=>{HAP.intensity=btn.dataset.haptic;document.querySelectorAll("[data-haptic]").forEach(b=>b.classList.toggle("active",b.dataset.haptic===HAP.intensity));HAP.vib('select');};});

document.getElementById("rematchBtn").onclick=()=>{
  if(ONLINE.inMatch)return;
  if(ONLINE.dc && ONLINE.dc.readyState==='open'){
    onlineDCSend('rematch_request');
    var rb=document.getElementById('rematchBtn');
    rb.textContent='Waiting...'; rb.disabled=true;
    return;
  }
  SND.confirm();document.getElementById("endMenu").style.display="none";startLocalGame();
};
function updateReviewUI(){
  const counter = document.getElementById("reviewCounter");
  const slider  = document.getElementById("reviewSlider");
  const miniTxt = document.getElementById("moveNumBarText");
  const total   = history.length;
  const current = reviewIndex;
  if(counter) counter.textContent = (current + 1) + " / " + total;
  if(slider){ slider.max = total - 1; slider.value = current; }
  if(miniTxt) miniTxt.textContent = "Move " + (current + 1) + " / " + total;
}

function syncMoveNumBar() {
  const miniTxt = document.getElementById("moveNumBarText");
  if(miniTxt) miniTxt.textContent = "Move " + history.length + " / " + history.length;
}

function setReviewing(val) {
  reviewing = val;
  const bar     = document.getElementById('reviewControls');
  const miniBar = document.getElementById('moveNumBar');
  if (val) {
    if (bar) bar.style.display = 'flex';
    if (miniBar) miniBar.style.display = 'none';
  } else {
    if (bar) bar.style.display = 'none';
    // Show mini-bar if game has moves
    if (miniBar) miniBar.style.display = (history && history.length > 0) ? 'flex' : 'none';
  }
}

document.getElementById("reviewBtn").onclick=()=>{
  SND.ui();
  document.getElementById("endMenu").style.display="none";

  if(!history || history.length===0) return;

  setReviewing(true);
  reviewIndex = history.length - 1;
  loadHistory(reviewIndex);
  updateReviewUI();
  // Keep pointer events active so board rotation still works in review mode
  // Piece selection is blocked by the `reviewing` flag in the touchstart handler
};
document.getElementById("endBackMenu").onclick=()=>{SND.confirm();document.getElementById("endMenu").style.display="none";if(typeof updateMenuSelection==='function')updateMenuSelection();onlineHideColorIndicator();localStorage.removeItem('cc_pending_match');var _rb=document.getElementById('rematchBtn');if(_rb){_rb.textContent='↺ Rematch';_rb.disabled=false;}botColor=null;exitPuzzleMode();resetBoard();turn="white";document.getElementById("hud").textContent="White to move";renderer.domElement.style.pointerEvents="none";var _rbtn=document.getElementById("rotateBoardBtn");if(_rbtn)_rbtn.style.display="none";var _pbn=document.getElementById("panBoardBtn");if(_pbn)_pbn.style.display="none";document.getElementById("mainMenu").style.display="flex";};

document.getElementById("zSlider").oninput=e=>{
  const prev=activeZ; activeZ=parseInt(e.target.value);
  update(); coords();
  if(activeZ!==prev){ SND.layer(activeZ); HAP.vib('layer'); flashLayerIndicator(activeZ); camOnLayerChange(); }
};

document.getElementById("moveToggle").onclick=()=>{const panel=document.getElementById("movePanel");panel.style.display=panel.style.display==="none"?"block":"none";};

document.getElementById("firstMove").onclick=()=>{SND.ui();if(reviewIndex<=0)return;reviewIndex=0;loadHistory(reviewIndex);updateReviewUI();};
document.getElementById("prevMove").onclick=()=>{SND.ui();if(reviewIndex<=0)return;reviewIndex--;loadHistory(reviewIndex);updateReviewUI();};
document.getElementById("nextMove").onclick=()=>{SND.ui();if(reviewIndex>=history.length-1)return;reviewIndex++;loadHistory(reviewIndex);updateReviewUI();};
document.getElementById("lastMove").onclick=()=>{SND.ui();if(reviewIndex>=history.length-1)return;reviewIndex=history.length-1;loadHistory(reviewIndex);updateReviewUI();};
document.getElementById("moveNumBar").onclick=()=>{
  if(!history||history.length===0)return;
  SND.ui();
  setReviewing(true);
  reviewIndex=history.length-1;
  loadHistory(reviewIndex);
  updateReviewUI();
};

document.getElementById("liveMove").onclick=()=>{
  SND.confirm();
  setReviewing(false);
  reviewIndex=history.length-1;
  loadHistory(reviewIndex);
  reviewArrows.forEach(a=>pivot.remove(a));reviewArrows=[];
  syncMoveNumBar();
};

// ── NEW MAIN MENU ────────────────────────────────────────────────────────────
document.getElementById('mainPlayBtn').onclick = () => {
  SND.ui();
  document.getElementById('mainMenu').style.display = 'none';
  const _ps1 = document.getElementById('playStep1');
  _ps1.style.display = 'flex';
  if (typeof initMenuFocus === 'function') initMenuFocus(_ps1);
};
document.getElementById('mainPuzzlesBtn').onclick = () => {
  SND.ui();
  document.getElementById('mainMenu').style.display = 'none';
  if (typeof openPuzzleSelect === 'function') openPuzzleSelect();
  else document.getElementById('puzzleSelectOverlay').style.display = 'flex';
};
document.getElementById('mainSettingsBtn').onclick = () => {
  SND.ui();
  document.getElementById('mainMenu').style.display = 'none';
  _settingsOrigin = 'mainMenu';
  const _so2 = document.getElementById('settingsOverlay');
  _so2.style.display = 'flex';
  if (typeof drawSettingsPreview === 'function') drawSettingsPreview();
  if (typeof initMenuFocus === 'function') initMenuFocus(_so2);
};
document.getElementById('mainProfileBtn').onclick = () => {
  SND.ui();
  document.getElementById('mainMenu').style.display = 'none';
  window._profileOrigin = 'mainMenu';
  openProfileOverlay();
};
/* Help is reachable from two places — the main menu, and the dock's ? during
   a match. Both close buttons used to force the main menu open unconditionally,
   so opening help mid-game and closing it THREW THE PLAYER OUT OF THE MATCH:
   the board stayed loaded underneath, but the menu was on top of it and the
   game was effectively abandoned.

   Closing help now returns to wherever it was opened from, which has to be
   captured at OPEN time — once the overlay is up there is nothing left on
   screen to infer it from. Every opener goes through openHelpOverlay(). */
window.openHelpOverlay = () => {
  const _mm = document.getElementById('mainMenu');
  window._helpCameFromMenu = !!(_mm && getComputedStyle(_mm).display !== 'none');
  if (_mm) _mm.style.display = 'none';
  const _ho = document.getElementById('helpOverlay');
  _ho.style.display = 'flex';
  if (typeof initMenuFocus === 'function') initMenuFocus(_ho);
};
window.closeHelpOverlay = () => {
  document.getElementById('helpOverlay').style.display = 'none';
  if (!window._helpCameFromMenu) return;   // came from a match — leave it be
  const _mm = document.getElementById('mainMenu');
  _mm.style.display = 'flex';
  if (typeof initMenuFocus === 'function') initMenuFocus(_mm);
};
document.getElementById('mainHelpBtn').onclick = () => { SND.ui(); window.openHelpOverlay(); };
document.getElementById('helpClose').onclick   = () => { SND.ui(); window.closeHelpOverlay(); };
document.getElementById('helpBackBtn').onclick = () => { SND.ui(); window.closeHelpOverlay(); };
document.getElementById('helpTutorialBtn').onclick = () => {
  SND.ui();
  document.getElementById('helpOverlay').style.display = 'none';
  const _to = document.getElementById('tutorialOverlay');
  _to.style.display = 'flex';
  if (typeof startTutorial === 'function') startTutorial();
  if (typeof initMenuFocus === 'function') initMenuFocus(_to);
};

// ── PLAY STEP 1 ─────────────────────────────────────────────────────────────
var _playMode = 'standard';
document.getElementById('ps1Back').onclick = () => {
  SND.ui();
  document.getElementById('playStep1').style.display = 'none';
  document.getElementById('mainMenu').style.display = 'flex';
};
document.getElementById('ps1Standard').onclick = () => { SND.confirm(); _playMode = 'standard'; _goToPlayStep2(); };
document.getElementById('ps1Arcade').onclick   = () => { SND.confirm(); _playMode = 'arcade';   _goToPlayStep2(); };
document.getElementById('ps1CTF').onclick      = () => { SND.confirm(); _playMode = 'ctf';      _goToPlayStep2(); };

function _goToPlayStep2() {
  document.getElementById('playStep1').style.display = 'none';
  const modeNames = { standard: 'STANDARD CHESS', arcade: 'ARCADE', ctf: 'CAPTURE THE FLAG' };
  document.getElementById('ps2Title').textContent = modeNames[_playMode] || 'PLAY';
  var onlineSub = document.getElementById('ps2OnlineSub');
  if (onlineSub) {
    var isOnl = typeof ONLINE !== 'undefined' && ONLINE.connected;
    onlineSub.textContent = isOnl ? 'Quick match · Friends · Private game' : 'Server offline — try again later';
    onlineSub.style.color = isOnl ? '#5e2750' : '#553322';
  }
  const _ps2 = document.getElementById('playStep2');
  _ps2.style.display = 'flex';
  if (typeof initMenuFocus === 'function') initMenuFocus(_ps2);
}

// ── PLAY STEP 2 ─────────────────────────────────────────────────────────────
var _playPlayers = 'local';
document.getElementById('ps2Back').onclick = () => { SND.ui(); document.getElementById('playStep2').style.display = 'none'; document.getElementById('playStep1').style.display = 'flex'; };
document.getElementById('ps2Local').onclick  = () => { SND.confirm(); _playPlayers = 'local';  _goToPlayStep3(); };
document.getElementById('ps2Bot').onclick    = () => { SND.confirm(); _playPlayers = 'bot';    _goToPlayStep3(); };
document.getElementById('ps2Online').onclick = () => {
  SND.confirm(); _playPlayers = 'online';
  document.getElementById('playStep2').style.display = 'none';
  if (typeof _openOnlinePlayStep === 'function') _openOnlinePlayStep();
};

function _goToPlayStep3() {
  document.getElementById('playStep2').style.display = 'none';
  document.getElementById('ps3DiffSection').style.display = (_playPlayers === 'bot') ? 'block' : 'none';
  document.getElementById('ps3ArcadeSection').style.display = (_playMode === 'arcade') ? 'block' : 'none';
  document.getElementById('ps3CTFSection').style.display   = (_playMode === 'ctf')    ? 'block' : 'none';
  const modeNames = { standard: 'CONFIGURE', arcade: 'ARCADE — CONFIGURE', ctf: 'CTF — CONFIGURE' };
  document.getElementById('ps3Title').textContent = modeNames[_playMode] || 'CONFIGURE';
  const _ps3 = document.getElementById('playStep3');
  _ps3.style.display = 'flex';
  if (typeof initMenuFocus === 'function') initMenuFocus(_ps3);
}

// ── PLAY STEP 3 ─────────────────────────────────────────────────────────────
var _ps3Diff = 'medium', _ps3Color = 'white', _ps3Time = 0;

document.querySelectorAll('[data-ps3diff]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); _ps3Diff = btn.dataset.ps3diff;
    document.querySelectorAll('[data-ps3diff]').forEach(b => b.classList.toggle('active', b.dataset.ps3diff === _ps3Diff));
    botDifficulty = _ps3Diff;
  };
});
document.querySelectorAll('[data-ps3color]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); _ps3Color = btn.dataset.ps3color;
    document.querySelectorAll('[data-ps3color]').forEach(b => b.classList.toggle('active', b.dataset.ps3color === _ps3Color));
  };
});
document.querySelectorAll('[data-time]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); _ps3Time = parseInt(btn.dataset.time);
    document.querySelectorAll('[data-time]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.time) === _ps3Time));
  };
});
document.getElementById('ps3ArcadeHeader').onclick = () => {
  SND.ui();
  var c = document.getElementById('ps3ArcadeContent'), a = document.getElementById('ps3ArcadeArrow');
  var open = c.style.display !== 'none';
  c.style.display = open ? 'none' : 'block';
  a.style.transform = open ? '' : 'rotate(180deg)';
};
document.querySelectorAll('[data-ps3arc]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); var key = btn.dataset.ps3arc; var on = btn.classList.toggle('on');
    btn.classList.toggle('off', !on); btn.textContent = on ? 'ON' : 'OFF';
    var leg = document.querySelector('[data-arc="'+key+'"]');
    if (leg) { leg.classList.toggle('on', on); leg.classList.toggle('off', !on); leg.textContent = on ? 'ON' : 'OFF'; }
  };
});
document.querySelectorAll('[data-ps3rate]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); var rate = btn.dataset.ps3rate;
    document.querySelectorAll('[data-ps3rate]').forEach(b => b.classList.toggle('active', b.dataset.ps3rate === rate));
    var leg = document.querySelector('[data-rate="'+rate+'"]');
    if (leg) { document.querySelectorAll('[data-rate]').forEach(b => b.classList.remove('active')); leg.classList.add('active'); }
  };
});
// ── CTF config ───────────────────────────────────────────────────────────────
var _ctfPoints = 1, _ctfIncrement = 0;
document.querySelectorAll('[data-ctfpts]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); _ctfPoints = parseInt(btn.dataset.ctfpts);
    document.querySelectorAll('[data-ctfpts]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.ctfpts) === _ctfPoints));
    var sl = document.getElementById('ps3CTFSlider'); if (sl) sl.value = _ctfPoints;
    var lb = document.getElementById('ps3CTFPtsLabel'); if (lb) lb.textContent = _ctfPoints;
  };
});
document.querySelectorAll('[data-ctfinc]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); _ctfIncrement = parseInt(btn.dataset.ctfinc);
    document.querySelectorAll('[data-ctfinc]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.ctfinc) === _ctfIncrement));
  };
});
document.getElementById('ps3CTFAdvHeader').onclick = () => {
  SND.ui();
  var c = document.getElementById('ps3CTFAdvContent'), open = c.style.display !== 'none';
  c.style.display = open ? 'none' : 'block';
  document.getElementById('ps3CTFAdvArrow').style.transform = open ? '' : 'rotate(180deg)';
};
(function() {
  var sl = document.getElementById('ps3CTFSlider');
  if (!sl) return;
  sl.oninput = () => {
    _ctfPoints = parseInt(sl.value);
    var lb = document.getElementById('ps3CTFPtsLabel'); if (lb) lb.textContent = _ctfPoints;
    document.querySelectorAll('[data-ctfpts]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.ctfpts) === _ctfPoints));
  };
})();

document.getElementById('ps3Back').onclick = () => { SND.ui(); document.getElementById('playStep3').style.display = 'none'; document.getElementById('playStep2').style.display = 'flex'; };
document.getElementById('ps3Play').onclick = () => {
  SND.confirm();
  document.getElementById('playStep3').style.display = 'none';
  if (_ps3Time > 0) { timeEnabled = true; TIME_CONTROL_MINS = _ps3Time; } else { timeEnabled = false; }
  var col = _ps3Color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : _ps3Color;
  // Apply hint/undo from new toggles
  var ps3h = document.getElementById('ps3HintToggle'), ps3u = document.getElementById('ps3UndoToggle');
  if (typeof BOT_OPTS !== 'undefined') { if (ps3h) BOT_OPTS.hint = ps3h.checked; if (ps3u) BOT_OPTS.undo = ps3u.checked; }
  if (_playMode === 'ctf') {
    ctfMode = true; arcadeSettings.enabled = false;
    CTF.pointTarget = _ctfPoints;
    CTF.increment   = _ctfIncrement;
    CTF.firstMover  = 'white';
    if (_playPlayers === 'bot') { botDifficulty = _ps3Diff; botColor = 'black'; playerColor = 'white'; }
    else { botColor = null; playerColor = 'white'; }
    startLocalGame();
    if (botColor === 'black') setTimeout(botMove, 400);
    return;
  }
  if (_playMode === 'arcade') {
    arcadeSettings.enabled = true; ctfMode = false;
    if (_playPlayers === 'bot') { botDifficulty = _ps3Diff; playerColor = col; botColor = (col === 'white' ? 'black' : 'white'); }
    else { botColor = null; playerColor = 'white'; }
    startLocalGame();
    if (botColor === 'white') setTimeout(botMove, 400);
    return;
  }
  arcadeSettings.enabled = false; ctfMode = false;
  if (_playPlayers === 'local') { botColor = null; playerColor = 'white'; startLocalGame(); }
  else if (_playPlayers === 'bot') {
    botDifficulty = _ps3Diff; playerColor = col; botColor = (col === 'white' ? 'black' : 'white');
    startLocalGame(); if (botColor === 'white') setTimeout(botMove, 400);
  }
};

// ── HUD GEAR BUTTON ──────────────────────────────────────────────────────────
(function() {
  var gearBtn   = document.getElementById('hudGearBtn');
  var panel     = document.getElementById('hudQuickPanel');

  function openPanel() {
    panel.style.display = 'block';
    if (typeof UI_PREFS !== 'undefined') {
      [['hqToggle_legalMoves','legalMoves'],['hqToggle_threats','threats'],
       ['hqToggle_coords','coords'],['hqToggle_trails','trails'],['hqToggle_lastMove','lastMove']]
      .forEach(([rowId, key]) => {
        var row = document.getElementById(rowId); if (!row) return;
        var dot = row.querySelector('.uiToggleDot'); if (!dot) return;
        var on = !!UI_PREFS[key]; dot.classList.toggle('on', on); dot.classList.toggle('off', !on);
      });
    }
  }
  function closePanel() { panel.style.display = 'none'; }

  // Gear button: toggle open/close — stopPropagation prevents doc listener
  function _gearToggle(e) {
    e.stopPropagation();
    SND.ui();
    if (panel.style.display === 'none') openPanel(); else closePanel();
  }
  gearBtn.addEventListener('click', _gearToggle);
  gearBtn.addEventListener('touchend', function(e) { e.preventDefault(); _gearToggle(e); });

  // Outside click/tap closes the panel (bubble phase — gear stopPropagation keeps it from firing on btn)
  document.addEventListener('click',    function(e) { if (panel.style.display!=='none' && !panel.contains(e.target)) closePanel(); });
  document.addEventListener('touchend', function(e) { if (panel.style.display!=='none' && !panel.contains(e.target) && e.target!==gearBtn) closePanel(); });

  // Panel rows need stopPropagation so tapping a toggle doesn't close the panel immediately
  panel.addEventListener('click',    function(e) { e.stopPropagation(); });
  panel.addEventListener('touchend', function(e) { e.stopPropagation(); });
})();
(function() {
  function _wireHudToggle(rowId, prefKey) {
    var row = document.getElementById(rowId); if (!row) return;
    var dot = row.querySelector('.uiToggleDot');
    row.onclick = () => {
      SND.ui(); var nowOn = dot && !dot.classList.contains('on');
      if (dot) { dot.classList.toggle('on', nowOn); dot.classList.toggle('off', !nowOn); }
      if (typeof applyUIPref === 'function') applyUIPref(prefKey, nowOn);
      else if (typeof UI_PREFS !== 'undefined') UI_PREFS[prefKey] = nowOn;
    };
  }
  _wireHudToggle('hqToggle_legalMoves','legalMoves');
  _wireHudToggle('hqToggle_threats','threats');
  _wireHudToggle('hqToggle_coords','coords');
  _wireHudToggle('hqToggle_trails','trails');
  _wireHudToggle('hqToggle_lastMove','lastMove');
})();

// Bot time control toggle
// Local (pass & play) time toggle
document.getElementById('localTimeToggle').onclick = function() {
  const isOn = this.textContent === 'OFF';
  this.textContent = isOn ? 'ON' : 'OFF';
  this.style.color = isOn ? '#00ccff' : '#333';
  this.style.borderColor = isOn ? '#00ccff' : '#1a1a1a';
  document.getElementById('localTimeMins').style.display = isOn ? 'inline-block' : 'none';
  document.getElementById('localTimeMins').style.color = isOn ? '#fff' : '#555';
};
document.getElementById('localTimeMins').onchange = function() {
  TIME_CONTROL_MINS = parseInt(this.value);
};

// Bot depth slider wiring
(function() {
  const slider=document.getElementById('botDepthSlider'), label=document.getElementById('botDepthLabel');
  const labels=['Random','Easy','Medium','Hard','Max','4L Max'];
  if(!slider)return; slider.value=botDepth; if(label)label.textContent=labels[botDepth];
  slider.oninput=()=>{ botDepth=parseInt(slider.value); if(label)label.textContent=labels[botDepth]; };
})();

// Bot opt toggles
(function(){
  function wireOpt(id,key){var btn=document.getElementById(id);if(!btn)return;btn.textContent=BOT_OPTS[key]?'ON':'OFF';btn.style.color=BOT_OPTS[key]?'#00ccff':'#333';btn.style.borderColor=BOT_OPTS[key]?'#00ccff':'#1a1a1a';btn.onclick=function(){BOT_OPTS[key]=!BOT_OPTS[key];btn.textContent=BOT_OPTS[key]?'ON':'OFF';btn.style.color=BOT_OPTS[key]?'#00ccff':'#333';btn.style.borderColor=BOT_OPTS[key]?'#00ccff':'#1a1a1a';};}
  wireOpt('botOptHint','hint'); wireOpt('botOptUndo','undo');
})();

// In-game hint / undo
document.getElementById('hintBtn').onclick = () => {
  SND.ui();
  if (PUZZLE_MODE) {
    const puzData = PUZZLE_TUT_KEY >= 0 ? TUT_PUZZLES[PUZZLE_TUT_KEY] : PUZZLES[PUZZLE_ACTIVE];
    if (puzData && typeof flashHintPiece === 'function') flashHintPiece(puzData);
  } else {
    showBotHint();
  }
};
document.getElementById('undoBtn').onclick = () => {
  if (PUZZLE_MODE) doPuzzleUndo();
  else doUndo();
};

// Layer visibility toggle
(function(){
  var btn=document.getElementById('layerVisToggle'); if(!btn)return;
  var modes=['limited','current','all'], labels2={limited:'◈ LTD',current:'◈ CUR',all:'◈ ALL'};
  function refreshBtn(){btn.textContent=labels2[LAYER_VIS.mode];btn.style.color=LAYER_VIS.mode==='all'?'#00ccff':LAYER_VIS.mode==='current'?'#ffaa00':'#aaa';}
  btn.onclick=function(){var i=modes.indexOf(LAYER_VIS.mode);LAYER_VIS.mode=modes[(i+1)%modes.length];update();refreshBtn();SND.ui();};
  refreshBtn();
})();

document.getElementById('botTimeToggle').onclick = function() {
  const isOn = this.textContent === 'OFF';
  this.textContent = isOn ? 'ON' : 'OFF';
  this.style.color = isOn ? '#00ccff' : '#333';
  this.style.borderColor = isOn ? '#00ccff' : '#1a1a1a';
  document.getElementById('botTimeMins').style.display = isOn ? 'inline-block' : 'none';
  document.getElementById('botTimeMins').style.color = isOn ? '#fff' : '#555';
  timeEnabled = isOn;
  if (isOn) TIME_CONTROL_MINS = parseInt(document.getElementById('botTimeMins').value);
};
document.getElementById('botTimeMins').onchange = function() {
  TIME_CONTROL_MINS = parseInt(this.value);
};
document.getElementById("backToMain").onclick=()=>{SND.ui();document.getElementById("modeMenu").style.display="none";document.getElementById("mainMenu").style.display="flex";};
document.getElementById("backToMode").onclick=()=>{SND.ui();document.getElementById("botMenu").style.display="none";document.getElementById("modeMenu").style.display="flex";};
document.querySelectorAll("#modeMenu .modeBtn").forEach(btn=>{btn.onclick=()=>{SND.confirm();if(btn.dataset.start==="botMenu"){document.getElementById("modeMenu").style.display="none";document.getElementById("botMenu").style.display="flex";return;}if(btn.dataset.start==="local"){
    botColor=null;playerColor="white";
    const ltOn = document.getElementById('localTimeToggle').textContent === 'ON';
    timeEnabled = ltOn;
    if(ltOn) TIME_CONTROL_MINS = parseInt(document.getElementById('localTimeMins').value);
    startLocalGame();
  }};});
document.querySelectorAll("#botMenu .modeBtn").forEach(btn=>{btn.onclick=()=>{
  SND.confirm();
  // Apply pre-game time settings
  const tOn = document.getElementById('botTimeToggle').textContent === 'ON';
  timeEnabled = tOn;
  if (tOn) TIME_CONTROL_MINS = parseInt(document.getElementById('botTimeMins').value);
  if(btn.dataset.start==="botWhite"){playerColor="white";botColor="black";startLocalGame();}
  if(btn.dataset.start==="botBlack"){playerColor="black";botColor="white";startLocalGame();setTimeout(botMove,400);}
  if(btn.dataset.start==="botRandom"){if(Math.random()<0.5){playerColor="white";botColor="black";}else{playerColor="black";botColor="white";}startLocalGame();if(botColor==="white")setTimeout(botMove,400);}
};});

/* ======================================================
   GAME START
====================================================== */
function setPOV(){pivot.rotation.x=0.1;pivot.rotation.y=playerColor==="black"?3+Math.PI:3;coords();}
function startLocalGame(){
  setGameInputEnabled(true);
  // Reset puzzle UI only — do NOT reset botColor/playerColor (caller sets those before calling us)
  PUZZLE_MODE=false; PUZZLE_ACTIVE=-1; PUZZLE_TUT_KEY=-1;
  clearTimeout(window._puzzleInfoAutoHide);
  document.getElementById('puzzleBar').style.display='none';
  document.getElementById('puzzleSuccess').style.display='none';
  var _it=document.getElementById('puzzleInfoToggle'), _ip=document.getElementById('puzzleInfoPopup');
  if(_it) _it.style.display='none'; if(_ip) _ip.style.display='none';
  resetBoard();turn="white";setPOV();coords();update();startGameMessage();gameStarted=false;
  document.getElementById("modeMenu").style.display="none";
  document.getElementById("botMenu").style.display="none";
  document.getElementById("hud").textContent="White to move";
  // Show rotate board button when game is active
  var _rbtn=document.getElementById("rotateBoardBtn");
  if(_rbtn) _rbtn.style.display="block";
  var _hbtn=document.getElementById('hintBtn'), _ubtn=document.getElementById('undoBtn');
  if(_hbtn) _hbtn.style.display=(botColor&&BOT_OPTS.hint)?'block':'none';
  if(_ubtn) _ubtn.style.display=(botColor&&BOT_OPTS.undo)?'block':'none';
  var _lvbtn=document.getElementById('layerVisToggle'); if(_lvbtn) _lvbtn.style.display='block';
  var _panBoardBtnGame=document.getElementById('panBoardBtn'); if(_panBoardBtnGame) _panBoardBtnGame.style.display='block';
  var _gear=document.getElementById('hudGearBtn'); if(_gear) _gear.style.display='block';
  // Steam rich presence
  if (window.electronAPI && window.electronAPI.setRichPresence) {
    const mode = botColor ? 'vs Bot' : (typeof ONLINE !== 'undefined' && ONLINE.inMatch) ? 'Online' : 'Local';
    window.electronAPI.setRichPresence(mode + ' – Move 0');
  }
}

// Wire promotion popup buttons
document.querySelectorAll('[data-promote]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    SND.confirm();
    resolvePromotion(btn.dataset.promote);
  });
});

/* ======================================================
   RENDER LOOP
====================================================== */
