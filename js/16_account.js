/* ================================================================
    █████╗  ██████╗ ██████╗ ██████╗ ██╗   ██╗███╗   ██╗████████╗
   ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║████╗  ██║╚══██╔══╝
   ███████║██║     ██║     ██║   ██║██║   ██║██╔██╗ ██║   ██║
   ██╔══██║██║     ██║     ██║   ██║██║   ██║██║╚██╗██║   ██║
   ██║  ██║╚██████╗╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║   ██║
   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝   ╚═╝
  PLAYER ACCOUNT + GAME SAVE SYSTEM
  ─────────────────────────────────
  • Works fully offline via localStorage
  • Designed for optional future server sync (see SYNC HOOKS)
  • Zero changes to existing game logic; wraps endGame / startLocalGame
================================================================ */

/* ── Storage keys ── */
const ACC_KEY       = 'cc_accounts';     // all registered accounts
const SESSION_KEY   = 'cc_session';      // currently logged-in username
const SAVES_KEY     = 'cc_saves';        // saved games (keyed by username)
const GUEST_USER    = '__guest__';

// ── Google OAuth Configuration ────────────────────────────────
// 1. Go to https://console.cloud.google.com/ → APIs & Services → Credentials
// 2. Create an OAuth 2.0 Client ID (Web application type)
// 3. Add your Pi server address to "Authorized JavaScript origins"
//    e.g. http://192.168.0.109:3000  or  http://localhost:3000
// 4. Paste the client_id below (not the secret — just the ID)
const GOOGLE_CLIENT_ID = '';  // e.g. '123456789-abc.apps.googleusercontent.com'

/* ── Account schema ──────────────────────────────────────────────
  {
    username     : string            unique, 1-18 chars
    avatar       : string            emoji piece
    created      : ISO timestamp
    passwordHash : string | null     hex SHA-256 hash (null = no password set)
    googleId     : string | null     Google subject ID (for SSO)
    googleEmail  : string | null     Google account email
    stats: { played, wins, losses, draws, botWins, puzzlesSolved }
  }
─────────────────────────────────────────────────────────────── */

/* ── In-memory session ── */
let ACC_active = null;   // currently loaded account object (null = no session)

/* ================================================================
   STORAGE HELPERS
================================================================ */
function accLoadAll() {
  try { return JSON.parse(localStorage.getItem(ACC_KEY)) || {}; }
  catch { return {}; }
}
function accSaveAll(db) {
  const serialised = JSON.stringify(db);
  localStorage.setItem(ACC_KEY, serialised);
  // Steam Cloud — keep accounts in sync across devices
  if (window.Steam && window.Steam.isAvailable && window.Steam.cloudWrite)
    window.Steam.cloudWrite('cc_accounts', serialised);
}
function accGet(username) {
  return accLoadAll()[username] || null;
}
function accSave(account) {
  const db = accLoadAll();
  db[account.username] = account;
  accSaveAll(db);
}
function accDeleteAccount(username) {
  const db = accLoadAll();
  delete db[username];
  accSaveAll(db);
  // Also delete saves
  const saves = savesLoadAll();
  delete saves[username];
  savesStoreAll(saves);
}

/* Saved games storage */
function savesLoadAll() {
  try { return JSON.parse(localStorage.getItem(SAVES_KEY)) || {}; }
  catch { return {}; }
}
function savesStoreAll(s) {
  localStorage.setItem(SAVES_KEY, JSON.stringify(s));
}
function savesForUser(username) {
  return savesLoadAll()[username] || [];
}
function savesPutForUser(username, saves) {
  const all = savesLoadAll();
  all[username] = saves;
  savesStoreAll(all);
}

/* ── Session ── */
function accSetSession(username) {
  if (username) localStorage.setItem(SESSION_KEY, username);
  else          localStorage.removeItem(SESSION_KEY);
}
function accGetSession() {
  return localStorage.getItem(SESSION_KEY) || null;
}

/* ================================================================
   ACCOUNT OPERATIONS
================================================================ */

// SHA-256 hash via Web Crypto (browser built-in, no library needed)
async function hashPassword(password) {
  if (!password) return null;
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function accRegister(username, avatar, password) {
  username = username.trim();
  if (!username || username.length < 2) return { err: 'Username must be at least 2 characters' };
  if (username.length > 18)             return { err: 'Username too long (max 18)' };
  if (!/^[a-zA-Z0-9_\- ]+$/.test(username)) return { err: 'Letters, numbers, _ - and spaces only' };
  if (!password || password.length < 6)  return { err: 'Password must be at least 6 characters' };
  if (password.length > 72)              return { err: 'Password too long' };
  const db = accLoadAll();
  if (db[username]) return { err: 'Username already taken' };
  const passwordHash = await hashPassword(password);
  const account = {
    username,
    avatar: avatar || '♟',
    created: new Date().toISOString(),
    passwordHash,
    googleId: null,
    googleEmail: null,
    stats: { played:0, wins:0, losses:0, draws:0, botWins:0, puzzlesSolved:0 }
  };
  accSave(account);
  return { account };
}

async function accLogin(username, password) {
  username = username.trim();
  const account = accGet(username);
  if (!account) return { err: 'Account not found — try creating one' };
  // Migration: if account has no password hash, allow login and set hash now
  if (!account.passwordHash) {
    if (password) {
      account.passwordHash = await hashPassword(password);
      accSave(account);
    }
    return { account };
  }
  if (!password) return { err: 'Password required' };
  const hash = await hashPassword(password);
  if (hash !== account.passwordHash) return { err: 'Incorrect password' };
  return { account };
}

function accActivate(account) {
  ACC_active = account;
  accSetSession(account.username);
  accUpdateBadge();
}

function accLogout() {
  ACC_active = null;
  accSetSession(null);
  accUpdateBadge();
  showAccountOverlay();
}

/* ================================================================
   STATS TRACKING
================================================================ */
function accRecordResult(result) {
  // result: 'win' | 'loss' | 'draw' | 'botWin'
  if (!ACC_active || ACC_active.username === GUEST_USER) return;
  ACC_active.stats.played++;
  if (result === 'win')     ACC_active.stats.wins++;
  if (result === 'loss')    ACC_active.stats.losses++;
  if (result === 'draw')    ACC_active.stats.draws++;
  if (result === 'botWin')  { ACC_active.stats.wins++; ACC_active.stats.botWins++; }
  accSave(ACC_active);
}

function accRecordPuzzle() {
  if (!ACC_active || ACC_active.username === GUEST_USER) return;
  ACC_active.stats.puzzlesSolved++;
  accSave(ACC_active);
}

/* ================================================================
   GAME SAVE / LOAD
================================================================ */

/* Save schema:
  {
    id       : timestamp string (unique key)
    label    : human label e.g. "vs Bot — Move 14"
    date     : ISO string
    mode     : 'local' | 'bot'
    pColor   : playerColor
    bColor   : botColor | null
    moveLog  : moveLog array snapshot
    snapshots: snapshots array (board states)
    history  : history array
    turnNum  : moveNumber
    turn     : current turn color
    arcadeOn : boolean
  }
*/
function gameSave() {
  if (!ACC_active) { accShowError('Log in to save games'); return; }
  if (!gameStarted && history.length === 0) { accShowError('No game in progress'); return; }
  if (promotionActive) { accShowError('Cannot save during promotion'); return; }

  const id    = Date.now().toString();
  const vsBot = !!botColor;
  const label = (vsBot ? 'vs Bot' : 'Local') + ' — Move ' + (moveNumber - 1 || 1);
  const save = {
    id,
    label,
    date: new Date().toISOString(),
    mode: vsBot ? 'bot' : 'local',
    pColor:    playerColor,
    bColor:    botColor,
    moveLog:   JSON.parse(JSON.stringify(moveLog)),
    snapshots: [...snapshots],
    history:   JSON.parse(JSON.stringify(history)),
    turnNum:   moveNumber,
    turn,
    arcadeOn:  arcadeSettings.enabled,
    lastDoublePawn: lastDoublePawn ? JSON.parse(JSON.stringify(lastDoublePawn)) : null
  };

  const saves = savesForUser(ACC_active.username);
  saves.unshift(save);                       // newest first
  if (saves.length > 20) saves.length = 20;  // cap at 20 saves
  savesPutForUser(ACC_active.username, saves);
  accShowError('Game saved ✓');
  setTimeout(() => accShowError(''), 2000);
  renderSavedGames();
}

function gameLoad(saveObj) {
  // Close profile panel
  document.getElementById('profileOverlay').style.display = 'none';
  document.getElementById('pauseMenu').style.display = 'none';

  // Restore game state
  playerColor = saveObj.pColor;
  botColor    = saveObj.bColor;
  moveNumber  = saveObj.turnNum;
  turn        = saveObj.turn;

  // Reset board to final snapshot
  exitPuzzleMode();
  resetBoard(false);   // keep moveLog allocation

  // Restore move log array and UI
  moveLog        = saveObj.moveLog;
  history        = saveObj.history;
  snapshots      = saveObj.snapshots;
  lastDoublePawn = saveObj.lastDoublePawn || null;

  // Rebuild move panel UI from saved log
  const panel = document.getElementById('movePanel');
  panel.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button id="copyMoves" class="copyBtn"><div class="copySq1"></div><div class="copySq2"></div></button></div>`;
  rebuildCopyButton();
  moveLog.forEach((m, index) => {
    const div = document.createElement('div');
    const prefix = m.turn === 'white' ? m.number + '. ' : '   ';
    div.textContent = prefix + m.piece + squareName(m.from.x,m.from.y,m.from.z) + (m.capture?'x':'-') + squareName(m.to.x,m.to.y,m.to.z);
    div.style.cursor = 'pointer';
    div.onclick = () => { reviewIndex = index; loadHistory(index); };
    panel.appendChild(div);
  });
  panel.scrollTop = panel.scrollHeight;

  // Restore board visuals from last snapshot
  if (snapshots && snapshots.length > 0) {
    reviewIndex = snapshots.length - 1;
    loadHistory(reviewIndex);
  }

  setGameInputEnabled(true);
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('hud').textContent = turn.charAt(0).toUpperCase() + turn.slice(1) + ' to move';
  setPOV();
  if (typeof camApplyMode !== 'undefined') camApplyMode(cameraMode, true);
  update(); coords();
  gameStarted = true;
  setReviewing(false);
}

function gameDelete(saveId) {
  if (!ACC_active) return;
  const saves = savesForUser(ACC_active.username).filter(s => s.id !== saveId);
  savesPutForUser(ACC_active.username, saves);
  renderSavedGames();
}

/* ================================================================
   UI — ACCOUNT OVERLAY (Login / Register)
================================================================ */
function showAccountOverlay() {
  document.getElementById('accountOverlay').style.display = 'flex';
  document.getElementById('mainMenu').style.display = 'none';
  accShowError('');
  showOfflineBannerIfStub();
}

function hideAccountOverlay() {
  document.getElementById('accountOverlay').style.display = 'none';
  document.getElementById('mainMenu').style.display = 'flex';
}

function accShowError(msg) {
  document.getElementById('acctError').textContent = msg;
}

function accUpdateBadge() {
  const badge = document.getElementById('accountBadge');
  if (!ACC_active || ACC_active.username === GUEST_USER) {
    badge.style.display = 'none';
    return;
  }
  badge.textContent = ACC_active.avatar + ' ' + ACC_active.username;
  badge.style.display = 'block';
}

/* Avatar picker */
/* ================================================================
   ACCOUNT UI — login/register tabs, password toggle, Google OAuth
================================================================ */
var acctSelectedAvatar = '♟';
var acctIsLoginMode = true;

function acctSetMode(isLogin) {
  acctIsLoginMode = isLogin;
  document.getElementById('acctTabLogin').classList.toggle('acct-tab-active', isLogin);
  document.getElementById('acctTabRegister').classList.toggle('acct-tab-active', !isLogin);
  document.getElementById('acctConfirmRow').style.display = isLogin ? 'none' : 'block';
  var reg = document.getElementById('acctAvatarRowReg');
  if (reg) reg.style.display = isLogin ? 'none' : 'flex';
  document.getElementById('acctActionBtn').textContent = isLogin ? 'LOGIN' : 'CREATE ACCOUNT';
  document.getElementById('acctPassword').setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
  accShowError('');
  if (!isLogin) document.getElementById('acctGoogleLinkPanel').style.display = 'none';
}

document.getElementById('acctTabLogin').onclick    = () => acctSetMode(true);
document.getElementById('acctTabRegister').onclick = () => acctSetMode(false);

// Avatar selection (works for both the existing #acctAvatarRow and the register-only #acctAvatarRowReg)
document.querySelectorAll('.acct-avatar').forEach(el => {
  el.onclick = () => {
    document.querySelectorAll('.acct-avatar').forEach(a => a.classList.remove('sel'));
    el.classList.add('sel');
    acctSelectedAvatar = el.dataset.av;
  };
});

// Password visibility toggles
function _makePasswordToggle(btnId, inputId) {
  var btn = document.getElementById(btnId);
  var inp = document.getElementById(inputId);
  if (!btn || !inp) return;
  btn.onclick = function(e) {
    e.preventDefault();
    var show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.style.color = show ? '#00e5ff' : '#0077aa';
  };
}
_makePasswordToggle('acctPwToggle', 'acctPassword');
_makePasswordToggle('acctConfirmToggle', 'acctConfirmPw');
_makePasswordToggle('acctGoogleLinkPwToggle', 'acctGoogleLinkPw');

// Main action button (LOGIN or CREATE ACCOUNT)
document.getElementById('acctActionBtn').onclick = async function() {
  const name = document.getElementById('acctName').value;
  const pw   = document.getElementById('acctPassword').value;
  this.disabled = true;
  if (acctIsLoginMode) {
    const result = await accLogin(name, pw);
    this.disabled = false;
    if (result.err) { accShowError(result.err); return; }
    accActivate(result.account);
    hideAccountOverlay();
  } else {
    const cpw = document.getElementById('acctConfirmPw').value;
    if (pw !== cpw) { accShowError('Passwords do not match'); this.disabled = false; return; }
    const result = await accRegister(name, acctSelectedAvatar, pw);
    this.disabled = false;
    if (result.err) { accShowError(result.err); return; }
    setTimeout(applyDefaultSettings, 100);
    accActivate(result.account);
    hideAccountOverlay();
  }
};

// Enter key submits
[document.getElementById('acctName'), document.getElementById('acctPassword'), document.getElementById('acctConfirmPw')].forEach(function(el) {
  if (!el) return;
  el.addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('acctActionBtn').click(); });
});

/* ── Google OAuth ── */
var _googlePendingProfile = null;  // { sub, email, name } from Google credential

function _initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID) {
    var noteEl = document.getElementById('acctGoogleNote');
    if (noteEl) noteEl.textContent = 'Configure GOOGLE_CLIENT_ID to enable';
    var btn = document.getElementById('acctGoogleBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.35'; }
    return;
  }
  if (window.location.protocol === 'file:') {
    var noteEl = document.getElementById('acctGoogleNote');
    if (noteEl) noteEl.textContent = 'Google sign-in requires HTTP server';
    var btn = document.getElementById('acctGoogleBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.35'; }
    return;
  }
  // Load GIS script lazily on first button click
  document.getElementById('acctGoogleBtn').addEventListener('click', function() {
    if (window._gisLoading) return;
    window._gisLoading = true;
    var noteEl = document.getElementById('acctGoogleNote');
    if (noteEl) noteEl.textContent = 'Loading Google sign-in…';
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = function() {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: _onGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      google.accounts.id.prompt();
      if (noteEl) noteEl.textContent = '';
    };
    s.onerror = function() {
      if (noteEl) noteEl.textContent = 'Failed to load Google sign-in';
      window._gisLoading = false;
    };
    document.head.appendChild(s);
  }, { once: true });
}

function _decodeGoogleJwt(token) {
  try {
    const parts = token.split('.');
    const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
  } catch(e) { return null; }
}

function _onGoogleCredential(response) {
  const profile = _decodeGoogleJwt(response.credential);
  if (!profile || !profile.sub) { accShowError('Google sign-in failed'); return; }
  const noteEl = document.getElementById('acctGoogleNote');
  if (noteEl) noteEl.textContent = '';

  // Check if any existing account has this Google ID
  const db = accLoadAll();
  const existing = Object.values(db).find(a => a.googleId === profile.sub);
  if (existing) {
    accActivate(existing);
    hideAccountOverlay();
    return;
  }

  // Not linked yet — show link/create panel
  _googlePendingProfile = profile;
  var panel = document.getElementById('acctGoogleLinkPanel');
  var nameEl = document.getElementById('acctGoogleLinkName');
  var userEl = document.getElementById('acctGoogleLinkUser');
  var errEl  = document.getElementById('acctGoogleLinkErr');
  if (nameEl) nameEl.textContent = 'Signed in as: ' + (profile.email || profile.name);
  // Suggest a sanitized username from Google name
  var suggested = (profile.name || '').replace(/[^a-zA-Z0-9_\- ]/g, '').slice(0, 18).trim();
  if (userEl) userEl.value = suggested;
  if (errEl)  errEl.textContent = '';
  if (panel)  panel.style.display = 'flex';
}

document.getElementById('acctGoogleLinkConfirm').onclick = async function() {
  if (!_googlePendingProfile) return;
  var username = document.getElementById('acctGoogleLinkUser').value.trim();
  var pw       = document.getElementById('acctGoogleLinkPw').value;
  var errEl    = document.getElementById('acctGoogleLinkErr');
  if (!username || username.length < 2) { if(errEl) errEl.textContent = 'Enter a username'; return; }

  const db = accLoadAll();
  var account;

  if (db[username]) {
    // Link to existing account — verify password
    if (!db[username].passwordHash && !pw) {
      // old account with no password — allow and link
    } else {
      if (!pw) { if(errEl) errEl.textContent = 'Enter password to link to existing account'; return; }
      const hash = await hashPassword(pw);
      if (hash !== db[username].passwordHash) { if(errEl) errEl.textContent = 'Incorrect password'; return; }
    }
    account = db[username];
    account.googleId    = _googlePendingProfile.sub;
    account.googleEmail = _googlePendingProfile.email;
    accSave(account);
  } else {
    // Create new account linked to Google (no password required)
    if (!/^[a-zA-Z0-9_\- ]+$/.test(username)) { if(errEl) errEl.textContent = 'Letters, numbers, _ - and spaces only'; return; }
    if (username.length > 18) { if(errEl) errEl.textContent = 'Username too long'; return; }
    account = {
      username,
      avatar: acctSelectedAvatar || '♟',
      created: new Date().toISOString(),
      passwordHash: pw ? await hashPassword(pw) : null,
      googleId:    _googlePendingProfile.sub,
      googleEmail: _googlePendingProfile.email,
      stats: { played:0, wins:0, losses:0, draws:0, botWins:0, puzzlesSolved:0 }
    };
    accSave(account);
    setTimeout(applyDefaultSettings, 100);
  }

  _googlePendingProfile = null;
  accActivate(account);
  hideAccountOverlay();
};

document.getElementById('acctGoogleLinkCancel').onclick = function() {
  _googlePendingProfile = null;
  document.getElementById('acctGoogleLinkPanel').style.display = 'none';
};

_initGoogleSignIn();

/* ── Link Google to the currently active account (from profile panel) ── */
function _linkGoogleToCurrentAccount() {
  if (!ACC_active || !GOOGLE_CLIENT_ID) return;
  // Re-initialize GIS with a callback that links to current account
  function _linkCallback(response) {
    var profile = _decodeGoogleJwt(response.credential);
    if (!profile || !profile.sub) return;
    // Check if another account already has this Google ID
    var db = accLoadAll();
    var taken = Object.values(db).find(function(a) { return a.googleId === profile.sub && a.username !== ACC_active.username; });
    if (taken) { alert('This Google account is already linked to "' + taken.username + '"'); return; }
    ACC_active.googleId    = profile.sub;
    ACC_active.googleEmail = profile.email;
    accSave(ACC_active);
    // Update profile button
    var glLabel = document.getElementById('profileLinkGoogleLabel');
    if (glLabel) glLabel.textContent = 'LINKED: ' + (profile.email || 'Google account');
    var glBtn = document.getElementById('profileLinkGoogleBtn');
    if (glBtn) { glBtn.style.opacity = '0.45'; glBtn.onclick = null; }
  }
  if (window.google && window.google.accounts) {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: _linkCallback });
    google.accounts.id.prompt();
  } else {
    // Load GIS if not yet loaded
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = function() {
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: _linkCallback });
      google.accounts.id.prompt();
    };
    document.head.appendChild(s);
  }
}


function applyDefaultSettings() {
  // Applied once to new users / guests. Sets all recommended visual defaults.
  const defaults = {
    ghosts: true,
    legalMoves: true, threats: true, lastMove: true,
    coords: true, boardRotate: true, pinchZoom: true, swipeLayer: true,
    autoRotate: false, idleSpin: true, threatArrows: true, hoverTooltip: true, layerLabels: true
  };
  Object.keys(defaults).forEach(key => {
    if (typeof applyUIPref === 'function') applyUIPref(key, defaults[key]);
  });
  // Ensure clock is hidden at start
  const cl = document.getElementById('chessClock');
  if (cl) cl.style.display = 'none';
}
document.getElementById('acctGuestBtn').onclick = () => {
  ACC_active = { username: GUEST_USER, avatar: '♟', stats: { played:0,wins:0,losses:0,draws:0,botWins:0,puzzlesSolved:0 } };
  accSetSession(GUEST_USER);
  accUpdateBadge();
  hideAccountOverlay();
  setTimeout(applyDefaultSettings, 100);
};

/* ================================================================
   UI — PROFILE OVERLAY
================================================================ */
function openProfileOverlay() {
  if (!ACC_active) { showAccountOverlay(); return; }
  // Fill stats
  const s = ACC_active.stats;
  document.getElementById('profileTitle').textContent =
    (ACC_active.avatar || '♟') + '  ' + (ACC_active.username === GUEST_USER ? 'GUEST' : ACC_active.username.toUpperCase());
  // Google link button state
  var glBtn = document.getElementById('profileLinkGoogleBtn');
  var glLabel = document.getElementById('profileLinkGoogleLabel');
  if (glBtn) {
    var hasGoogle = !!(ACC_active.googleId);
    glBtn.disabled = (!GOOGLE_CLIENT_ID || window.location.protocol === 'file:');
    if (glLabel) glLabel.textContent = hasGoogle
      ? 'LINKED: ' + (ACC_active.googleEmail || 'Google account')
      : 'LINK GOOGLE ACCOUNT';
    glBtn.style.opacity = (hasGoogle || !GOOGLE_CLIENT_ID || window.location.protocol === 'file:') ? '0.45' : '1';
    if (!hasGoogle && GOOGLE_CLIENT_ID && window.location.protocol !== 'file:') {
      glBtn.onclick = function() { _linkGoogleToCurrentAccount(); };
    }
  }
  document.getElementById('pStatPlayed').textContent  = s.played;
  document.getElementById('pStatWins').textContent    = s.wins;
  document.getElementById('pStatLosses').textContent  = s.losses;
  document.getElementById('pStatDraws').textContent   = s.draws;
  document.getElementById('pStatBotWins').textContent = s.botWins;
  document.getElementById('pStatPuzzles').textContent = s.puzzlesSolved;
  // Hide save button for guests
  document.getElementById('saveCurrentBtn').style.display =
    ACC_active.username === GUEST_USER ? 'none' : 'block';
  renderSavedGames();
  // Friends section — show when online and logged in
  var fSection = document.getElementById('profileFriendsSection');
  if (fSection) {
    var onlineLoggedIn = typeof ONLINE !== 'undefined' && ONLINE.loggedIn;
    fSection.style.display = onlineLoggedIn ? 'block' : 'none';
    if (onlineLoggedIn) {
      var fCount = document.getElementById('pStatFriends');
      if (fCount) fCount.textContent = (ONLINE.friends || []).length;
    }
  }
  // Reset delete confirmation state each time the panel opens
  document.getElementById('deleteAccountSection').style.display = 'none';
  document.getElementById('acctDeleteBtn').style.display =
    (ACC_active && ACC_active.username !== GUEST_USER) ? 'block' : 'none';
  document.getElementById('profileOverlay').style.display = 'flex';
}

function renderSavedGames() {
  const list = document.getElementById('savedGamesList');
  list.innerHTML = '';
  if (!ACC_active || ACC_active.username === GUEST_USER) {
    list.innerHTML = '<div style="font-size:11px;color:#444;text-align:center;padding:8px;">Log in to save games</div>';
    return;
  }
  const saves = savesForUser(ACC_active.username);
  if (!saves.length) {
    list.innerHTML = '<div style="font-size:11px;color:#444;text-align:center;padding:8px;">No saved games</div>';
    return;
  }
  saves.forEach(s => {
    const row = document.createElement('div');
    row.className = 'saved-game-row';
    const dateStr = new Date(s.date).toLocaleDateString(undefined, {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    row.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div style="color:#ccc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.label}</div>
        <div style="color:#444;font-size:10px;">${dateStr}</div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0;">
        <button class="load-btn" data-id="${s.id}">LOAD</button>
        <button class="del-btn"  data-id="${s.id}">✕</button>
      </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.load-btn').forEach(btn => {
    btn.onclick = () => {
      const s = savesForUser(ACC_active.username).find(x => x.id === btn.dataset.id);
      if (s) gameLoad(s);
    };
  });
  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = () => gameDelete(btn.dataset.id);
  });
}

document.getElementById('profileCloseBtn').onclick = () => {
  document.getElementById('profileOverlay').style.display = 'none';
  if (window._profileOrigin === 'pauseMenu') {
    document.getElementById('pauseMenu').style.display = 'flex';
  } else {
    document.getElementById('mainMenu').style.display = 'flex';
  }
};
document.getElementById('profileViewFriendsBtn').onclick = () => {
  document.getElementById('profileOverlay').style.display = 'none';
  if (typeof openFriendPanel === 'function') openFriendPanel(false);
};
document.getElementById('profileAddFriendBtn').onclick = () => {
  document.getElementById('profileOverlay').style.display = 'none';
  if (typeof openFriendPanel === 'function') openFriendPanel(true);
};
document.getElementById('saveCurrentBtn').onclick = () => gameSave();
document.getElementById('acctLogoutBtn').onclick  = () => {
  document.getElementById('profileOverlay').style.display = 'none';
  accLogout();
};

/* ── Delete account flow ── */
document.getElementById('acctDeleteBtn').onclick = () => {
  document.getElementById('deleteAccountSection').style.display = 'block';
  document.getElementById('acctDeleteBtn').style.display = 'none';
  document.getElementById('deleteAccountConfirmInput').value = '';
  document.getElementById('deleteAccountConfirmInput').focus();
};
document.getElementById('deleteAccountCancelBtn').onclick = () => {
  document.getElementById('deleteAccountSection').style.display = 'none';
  document.getElementById('acctDeleteBtn').style.display = 'block';
};
document.getElementById('deleteAccountConfirmBtn').onclick = () => {
  if (!ACC_active || ACC_active.username === GUEST_USER) return;
  const typed = document.getElementById('deleteAccountConfirmInput').value.trim();
  if (typed !== ACC_active.username) {
    document.getElementById('deleteAccountConfirmInput').style.borderColor = '#ff4444';
    setTimeout(() => { document.getElementById('deleteAccountConfirmInput').style.borderColor = '#ff444488'; }, 600);
    return;
  }
  const username = ACC_active.username;
  accDeleteAccount(username);
  ACC_active = null;
  accSetSession(null);
  accUpdateBadge();
  document.getElementById('profileOverlay').style.display = 'none';
  document.getElementById('deleteAccountSection').style.display = 'none';
  document.getElementById('acctDeleteBtn').style.display = 'block';
  showAccountOverlay();
};
document.getElementById('pauseProfileBtn').onclick = () => {
  SND.ui();
  document.getElementById('pauseMenu').style.display = 'none';
  window._profileOrigin = 'pauseMenu';
  openProfileOverlay();
};

/* ================================================================
   UI SETTINGS PANEL — wire toggles
================================================================ */
// var (not const/let) — must hoist because anim() references UI_PREFS
// before this line executes in script parse order.
var UI_PREFS = (function() {
  var defaults = {
  ghosts:            true,
  legalMoves:        true,
  threats:           true,
  lastMove:          true,
  coords:            true,
  clock:             false,
  boardRotate:       true,
  pinchZoom:         true,
  swipeLayer:        true,
  autoRotate:        false,
  idleSpin:          true,
  threatArrows:      true,
  hoverTooltip:      true,
  layerLabels:       true,
  opponentLayerAnim: true,
  glow:              true,
  layerHL:           true,
  arcadeAuras:       true,
  autoLayerSwitch:   false,
  threatVisionAlways:false
  };
  try { var saved = JSON.parse(localStorage.getItem('cc_ui_prefs') || 'null'); if (saved) Object.assign(defaults, saved); } catch(e) {}
  return defaults;
})();

function applyUIPref(key, val) {
  UI_PREFS[key] = val;
  try {
    const serialised = JSON.stringify(UI_PREFS);
    localStorage.setItem('cc_ui_prefs', serialised);
    if (window.Steam && window.Steam.isAvailable && window.Steam.cloudWrite)
      window.Steam.cloudWrite('cc_ui_prefs', serialised);
  } catch(e) {}
  const dot = document.querySelector(`#uiToggle_${key} .uiToggleDot`);
  if (dot) { dot.className = 'uiToggleDot ' + (val ? 'on' : 'off'); }
  switch (key) {
    case 'ghosts':
      if (!val) clearGhosts();
      break;
    case 'legalMoves':
      CFG.hl.legal.on = val;
      movePlates.forEach(p => { p.visible = val && isLayerShowing(p.userData.z); });
      break;
    case 'threats':
      CFG.hl.threats.on = val;
      threatPlates.forEach(p => { p.visible = val && (p.userData.z === undefined || isLayerShowing(p.userData.z)); });
      break;
    case 'lastMove':
      CFG.hl.lastMove.on = val;
      lastMoveSquares.forEach(p => { p.visible = val && isLayerShowing(p.userData.z); });
      break;
    case 'coords':
      cg.visible = val;
      break;
    case 'clock':
      timeEnabled = val;
      const clockEl2 = document.getElementById('chessClock');
      if (clockEl2) clockEl2.style.display = val ? 'flex' : 'none';
      break;
    case 'layerLabels': {
      const ll = document.getElementById('layerLabelsEl');
      if (ll) ll.style.display = val ? 'flex' : 'none';
      break;
    }
    case 'autoRotate': break; // handled in anim loop
    case 'idleSpin':   break; // handled in anim loop
    case 'threatArrows': break; // handled in showThreatLines
    case 'hoverTooltip': break; // handled in touch handler
  }
}

Object.keys(UI_PREFS).forEach(key => {
  const row = document.getElementById(`uiToggle_${key}`);
  if (!row) return;
  row.onclick = () => applyUIPref(key, !UI_PREFS[key]);
});

document.getElementById('uiSettingsBtn').onclick = () => {
  SND.ui();
  document.getElementById('pauseMenu').style.display = 'none';
  document.getElementById('uiSettingsOverlay').style.display = 'flex';
};
document.getElementById('uiSettingsBack').onclick = () => {
  document.getElementById('uiSettingsOverlay').style.display = 'none';
  document.getElementById('pauseMenu').style.display = 'flex';
};
document.getElementById('openKeyBindingsBtn').onclick = () => {
  SND.ui();
  document.getElementById('uiSettingsOverlay').style.display = 'none';
  _settingsOrigin = 'uiSettingsOverlay';
  if (typeof openSettingsWithSnapshot === 'function') openSettingsWithSnapshot();
  document.getElementById('settingsOverlay').style.display = 'flex';
  document.querySelectorAll('.stTab').forEach(b => { b.classList.remove('active'); const p = document.getElementById(b.dataset.page); if(p) p.classList.remove('active'); });
  document.querySelectorAll('.advTab').forEach(b => { b.classList.remove('active'); const p = document.getElementById(b.dataset.adv); if(p) p.classList.remove('active'); });
  const moreTab = document.querySelector('.stTab[data-page="pageMore"]');
  if (moreTab) { moreTab.classList.add('active'); document.getElementById('pageMore').classList.add('active'); }
  const inputTab = document.querySelector('.advTab[data-adv="pageInput"]');
  if (inputTab) { inputTab.classList.add('active'); document.getElementById('pageInput').classList.add('active'); }
};

// Patch touch handlers to respect UI_PREFS
(function patchTouchPrefs() {
  const origPinch = renderer.domElement.ontouchstart;
  // Board rotation and pinch zoom gating done via flags read in the touch handler
  // We expose them as globals read by the existing camera touch code
  window._UI_PREFS = UI_PREFS;
})();


/* ================================================================
   HOOK INTO EXISTING GAME EVENTS
================================================================ */

/* ── Wrap endGame to record stats ── */
const _acctBaseEndGame = endGame;
endGame = function(message) {
  _acctBaseEndGame(message);
  if (!ACC_active || ACC_active.username === GUEST_USER) return;
  const m = message.toLowerCase();
  const iWon  = (m.includes('white') && playerColor === 'white') ||
                (m.includes('black') && playerColor === 'black');
  const iLost = (m.includes('white') && playerColor === 'black') ||
                (m.includes('black') && playerColor === 'white');
  const isDraw = m.includes('draw') || m.includes('stalemate');
  const vsBot  = !!botColor;
  if (isDraw)       accRecordResult('draw');
  else if (iWon)    accRecordResult(vsBot ? 'botWin' : 'win');
  else if (iLost)   accRecordResult('loss');
};

/* ── Wrap puzzle success to record solved count ── */
const _acctBasePuzzleSuccess = showPuzzleSuccess;
showPuzzleSuccess = function(puzData) {
  _acctBasePuzzleSuccess(puzData);
  accRecordPuzzle();
};

/* ================================================================
   SYNC HOOKS — wired to the online server where endpoints exist
================================================================ */
const SYNC = {
  _isStub: false,

  /* Pull server-side ELO + stats and merge into local account */
  pullAccount: async (username) => {
    var local = accGet(username);
    if (localStorage.getItem('cc_online_enabled') !== '1') return local;
    var base = (localStorage.getItem('cc_server_url') || '').replace('ws://','http://').replace('wss://','https://');
    if (!base) return local;
    try {
      var res = await Promise.race([
        fetch(base + '/player/' + encodeURIComponent(username)),
        new Promise(function(_,rej){ setTimeout(function(){ rej(new Error('timeout')); }, 2000); })
      ]);
      if (!res.ok) return local;
      var p = await res.json();
      // Merge server stats into local account (server is authoritative for ELO/rated games)
      if (local && p) {
        local.elo        = p.elo        || local.elo;
        local.ratedGames = p.ratedGames || local.ratedGames;
        local.wins       = p.wins       || local.wins;
        local.draws      = p.draws      || local.draws;
        local.losses     = p.losses     || local.losses;
        local.avatar     = p.avatar     || local.avatar;
        accSave(local);
      }
      return local;
    } catch(e) { return local; }
  },

  /* Push avatar change to server via WebSocket (only field server can accept) */
  pushAccount: async (account) => {
    if (typeof ONLINE !== 'undefined' && ONLINE.loggedIn && account && account.avatar)
      onlineSend('update_avatar', { avatar: account.avatar });
    return { ok: true };
  },

  /* No server endpoint for saves — local only */
  pushSave: async (username, save) => {
    return { ok: true };
  }
};

function showOfflineBannerIfStub() {
  if (SYNC._isStub && !window._uiHidden) {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.style.display = 'flex';
  }
}

/* ================================================================
   BOOT — Restore session or show login
================================================================ */
(function bootAccountSystem() {
  // Steam Cloud — pull saved data before restoring session
  if (window.Steam && window.Steam.isAvailable && window.Steam.cloudRead) {
    try {
      const cloudAccounts = window.Steam.cloudRead('cc_accounts');
      if (cloudAccounts) {
        const cloudDb = JSON.parse(cloudAccounts);
        const localDb = accLoadAll();
        // Merge: cloud wins for each username (cloud is cross-device authoritative)
        Object.assign(localDb, cloudDb);
        localStorage.setItem(ACC_KEY, JSON.stringify(localDb));
      }
      const cloudPrefs = window.Steam.cloudRead('cc_ui_prefs');
      if (cloudPrefs) localStorage.setItem('cc_ui_prefs', cloudPrefs);
    } catch(e) {}
  }

  const session = accGetSession();
  if (session === GUEST_USER) {
    ACC_active = { username: GUEST_USER, avatar: '♟', stats: {played:0,wins:0,losses:0,draws:0,botWins:0,puzzlesSolved:0} };
    accUpdateBadge();
    return;   // go straight to main menu
  }
  if (session) {
    const account = accGet(session);
    if (account) {
      accActivate(account);
      return;  // resume session, stay on main menu
    }
  }
  // No valid session — start as guest silently; user logs in via main menu button.
  ACC_active = { username: GUEST_USER, avatar: '♟', stats: {played:0,wins:0,losses:0,draws:0,botWins:0,puzzlesSolved:0} };
  accSetSession(GUEST_USER);
  accUpdateBadge();
})();

