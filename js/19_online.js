/* ================================================================
   ONLINE MODULE  (WebSocket matchmaking + WebRTC P2P)
================================================================ */

var CC_DEFAULT_SERVER = 'wss://cubic-chess.tail09d577.ts.net'; // ← replace with output of: tailscale funnel 3000

var ONLINE_SERVER = (function() {
  var loc = window.location;
  // Capacitor (Android/iOS WebView) — always use production server
  if (typeof window !== 'undefined' && window.Capacitor) return CC_DEFAULT_SERVER;
  // Electron (Steam/desktop) — always use production server
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) return CC_DEFAULT_SERVER;
  // Dev: served from a non-localhost port — use same host with ws://
  if (loc.port && loc.hostname !== 'localhost' && loc.hostname !== '127.0.0.1')
    return 'ws://' + loc.hostname + ':' + loc.port;
  return localStorage.getItem('cc_server_url') || CC_DEFAULT_SERVER;
})();

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _onlineConfirm(message, onConfirm) {
  var ex = document.getElementById('_onlineConfirmModal'); if (ex) ex.remove();
  var el = document.createElement('div');
  el.id = '_onlineConfirmModal';
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:rgba(0,0,0,0.97);border:1px solid #0a1e30;font-family:monospace;color:#cce8ff;'
    + 'padding:24px 28px;z-index:9999;text-align:center;letter-spacing:1px;min-width:220px;border-radius:4px;';
  el.innerHTML = '<div style="font-size:11px;color:#6ab4d8;margin-bottom:16px;">'+_esc(message)+'</div>'
    + '<div style="display:flex;gap:8px;justify-content:center;">'
    + '<button id="_ocYes" style="background:rgba(10,12,20,0.95);border:1px solid #00e5ff;color:#00e5ff;font-family:monospace;font-size:10px;padding:7px 18px;cursor:pointer;letter-spacing:1px;">YES</button>'
    + '<button id="_ocNo" style="background:#040c16;border:1px solid #0a1e30;color:#3a7a9b;font-family:monospace;font-size:10px;padding:7px 16px;cursor:pointer;letter-spacing:1px;">CANCEL</button>'
    + '</div>';
  document.body.appendChild(el);
  el.querySelector('#_ocYes').onclick = function() { el.remove(); onConfirm(); };
  el.querySelector('#_ocNo').onclick  = function() { el.remove(); };
}

var ONLINE = {
  ws: null, pc: null, dc: null,
  connected: false, loggedIn: false, inMatch: false,
  roomId: null, myColor: null, player: null, opponent: null,
  rated: true, gameMode: 'standard', timeControl: 'none',
  currentPool: null,
  pingMs: null, _pingT: 0, _status: 'offline', _drawOfferSent: false, _syncing: false, _rtcTimer: null,
  friends: [], requests: [], pendingOut: [],
  poolRatings: {}, poolCounts: {},
  corrGames: { myTurn: [], theirTurn: [] }, corrGame: null, mySeek: null,
  setStatus: function(s) { ONLINE._status = s; onlineUpdateStatusBar(); }
};

function onlineConnect(serverUrl) {
  if (ONLINE.ws && ONLINE.ws.readyState < 2) ONLINE.ws.close();
  ONLINE.setStatus('connecting');
  try {
    var ws = new WebSocket(serverUrl);
    ONLINE.ws = ws;
    ws.onopen = function() {
      ONLINE.connected = true; ONLINE.setStatus('idle');
      ws._reconnectAttempt = 0; // reset on successful open
      localStorage.setItem('cc_server_url', serverUrl);
      onlineLog('Connected');
      onlineUpdateUI();
      var storedToken = localStorage.getItem('cc_online_token');
      if (storedToken) { onlineSend('login_token', { token: storedToken }); }
      else { var stored = localStorage.getItem('cc_online_username'); if (stored) onlineSend('login', { username: stored, password: '' }); }
    };
    ws.onmessage = function(ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch { return; }
      try { onlineHandle(msg); } catch(e) { onlineLog('Handler error: ' + e.message); }
    };
    ws.onclose = function() {
      ONLINE.connected = false; ONLINE.loggedIn = false;
      // Don't clear inMatch — server gives 60s reconnect window
      ONLINE.setStatus('offline'); onlineLog('Disconnected'); onlineUpdateUI();
      if (localStorage.getItem('cc_online_enabled') !== '1') return;
      var attempt = (ws._reconnectAttempt || 0) + 1;
      // Exponential backoff: 5s, 10s, 20s, 40s, then every 60s — no cap on attempts
      var delay = attempt <= 5 ? Math.min(5000 * Math.pow(2, attempt - 1), 60000) : 60000;
      onlineLog('Reconnecting in ' + Math.round(delay/1000) + 's (attempt ' + attempt + ')…');
      setTimeout(function() {
        var url = localStorage.getItem('cc_server_url');
        if (url && localStorage.getItem('cc_online_enabled') === '1') {
          onlineConnect(url);
          if (ONLINE.ws) ONLINE.ws._reconnectAttempt = attempt;
        }
      }, delay);
    };
    ws.onerror = function() { ONLINE.setStatus('offline'); onlineLog('Connection error'); };
  } catch(e) { ONLINE.setStatus('offline'); onlineLog('Could not connect: ' + e.message); }
}

function onlineSend(type, payload) {
  if (ONLINE.ws && ONLINE.ws.readyState === WebSocket.OPEN)
    ONLINE.ws.send(JSON.stringify({ type: type, payload: payload }));
}

function onlineHandle(msg) {
  var type = msg.type, payload = msg.payload || {};
  switch (type) {
    case 'welcome': onlineLog('Server online: ' + (payload.online || 1)); break;
    case 'register_ok':
      ONLINE.player = payload.player; ONLINE.loggedIn = true;
      localStorage.setItem('cc_online_username', payload.player.username);
      if (payload.token) localStorage.setItem('cc_online_token', payload.token);
      onlineLog('Registered as ' + payload.player.username);
      ONLINE.poolRatings = {};
      onlineUpdateUI(); onlineCloseAuthOverlay(); break;
    case 'register_err': {
      var _gns2 = document.getElementById('onlineGoogleUsernameSection');
      if (_gns2 && _gns2.style.display !== 'none') {
        var _gErr = document.getElementById('onlineGoogleUsernameError');
        if (_gErr) _gErr.textContent = payload.msg;
      } else {
        onlineShowAuthError(payload.msg);
      }
      break;
    }
    case 'login_ok':
      ONLINE.player = payload.player; ONLINE.loggedIn = true;
      localStorage.setItem('cc_online_username', payload.player.username);
      if (payload.token) localStorage.setItem('cc_online_token', payload.token);
      onlineLog('Logged in as ' + payload.player.username);
      if (payload.player.ratings) ONLINE.poolRatings = payload.player.ratings;
      onlineUpdateUI(); onlineCloseAuthOverlay();
      onlineSend('rating:all', {});
      onlineSend('corr:games_list', {});
      var _pm = localStorage.getItem('cc_pending_match');
      if (_pm) { try { var _pmd = JSON.parse(_pm); onlineSend('reconnect', { roomId: _pmd.roomId }); } catch(e) {} }
      break;
    case 'login_err': onlineShowAuthError(payload.msg); break;
    case 'login_token_err':
      localStorage.removeItem('cc_online_token');
      onlineLog('Session expired — please log in');
      onlineUpdateUI(); break;
    case 'google_need_username': {
      var _gns = document.getElementById('onlineGoogleUsernameSection');
      var _gas = document.getElementById('onlineAuthSection');
      var _gem = document.getElementById('onlineGoogleEmail');
      window._onlineGooglePendingId = payload.googleId;
      window._onlineGooglePendingEmail = payload.email;
      if (_gem) _gem.textContent = payload.email || '';
      if (_gas) _gas.style.display = 'none';
      if (_gns) _gns.style.display = 'block';
      break;
    }
    case 'google_ok':
      ONLINE.player = payload.player; ONLINE.loggedIn = true;
      localStorage.setItem('cc_online_username', payload.player.username);
      if (payload.token) localStorage.setItem('cc_online_token', payload.token);
      onlineLog('Signed in with Google as ' + payload.player.username);
      if (payload.player.ratings) ONLINE.poolRatings = payload.player.ratings;
      onlineUpdateUI(); onlineCloseAuthOverlay();
      onlineSend('rating:all', {});
      onlineSend('corr:games_list', {});
      break;
    case 'reconnect_ok':
      ONLINE.roomId = payload.roomId; ONLINE.myColor = payload.color;
      ONLINE.opponent = payload.opponent; ONLINE.inMatch = true;
      ONLINE.rated = payload.rated !== false;
      ONLINE.gameMode = payload.gameMode || 'standard';
      ONLINE.timeControl = payload.timeControl || 'none';
      ONLINE.setStatus('playing');
      onlineLog('Reconnected to match vs ' + payload.opponent.username);
      onlineShowColorIndicator(ONLINE.myColor, ONLINE.opponent);
      onlineStartMatch({ reconnecting: true }); break;
    case 'reconnect_err':
      localStorage.removeItem('cc_pending_match');
      onlineLog('Reconnect failed: ' + payload.msg); break;
    case 'opponent_temporarily_disconnected':
      onlineShowToast('Opponent disconnected — waiting up to 60s...', 0xffaa00); break;
    case 'opponent_reconnected':
      onlineShowToast('Opponent reconnected!', 0x00ff88);
      onlineStartMatch(null); break;
    case 'queued': ONLINE.setStatus('queued'); _queueCompatible = payload.compatible || 0; onlineLog('In queue'); break;
    case 'queue_update': {
      var _rangeLabel = payload.eloRange > 0 ? '±' + payload.eloRange : 'Any';
      _queueCompatible = payload.compatible || 0;
      var _qs = document.getElementById('onlineQueueStatus');
      if (_qs) _qs.textContent = 'Widening to ' + _rangeLabel + ' ELO...';
      _queueHoldUntil = Date.now() + 4000;
      onlineLog('Queue range widened to ' + _rangeLabel);
      break;
    }
    case 'queue_left': ONLINE.setStatus('idle'); break;
    case 'match_found':
      _dcSendSeq = 0; _dcExpectedSeq = 0; _dcLastMoveAt = 0;
      ONLINE.roomId = payload.roomId; ONLINE.myColor = payload.color;
      ONLINE.opponent = payload.opponent; ONLINE.inMatch = true;
      ONLINE.rated = payload.rated !== false;
      ONLINE.gameMode = payload.gameMode || 'standard';
      ONLINE.timeControl = payload.timeControl || 'none';
      ONLINE.currentPool = payload.pool || null;
      ONLINE.setStatus('playing');
      localStorage.setItem('cc_pending_match', JSON.stringify({ roomId: payload.roomId, myColor: payload.color, opponent: payload.opponent, gameMode: ONLINE.gameMode, timeControl: ONLINE.timeControl, rated: ONLINE.rated }));
      onlineLog('Match found! vs ' + payload.opponent.username);
      onlineStartMatch(payload); break;
    case 'signal': onlineHandleSignal(payload.signal, payload.from); break;
    case 'elo_update':
      var delta = payload.delta;
      onlineLog('ELO ' + (delta > 0 ? '+' : '') + delta + ' -> ' + payload.elo);
      if (ONLINE.player) { ONLINE.player.elo = payload.elo; ONLINE.player.ratedGames = (ONLINE.player.ratedGames||0)+1; }
      onlineShowEloToast(delta, payload.elo, payload.result);
      onlineUpdateUI(); ONLINE.inMatch = false; ONLINE.setStatus('idle'); break;
    case 'opponent_disconnected':
      onlineLog('Opponent disconnected');
      if (ONLINE.inMatch) {
        onlineShowToast('Opponent disconnected - you win!', 0x00ff88);
        onlineSend('game_result', { roomId: ONLINE.roomId, result: ONLINE.myColor === 'white' ? 'white_wins' : 'black_wins' });
        onlineHideColorIndicator();
      }
      break;
    case 'pong': ONLINE.pingMs = Date.now() - ONLINE._pingT; onlineUpdateStatusBar(); updateSignalIndicator(); break;

    case 'friends_list':
      ONLINE.friends  = payload.friends  || [];
      ONLINE.requests = (payload.requests || []).map(function(r) { return { from: r.from, avatar: r.avatar || '♟' }; });
      onlineUpdateFriends(); break;
    case 'friend_status': {
      var _ff = ONLINE.friends.find(function(f) { return f.username === payload.username; });
      if (_ff) { _ff.status = payload.status; onlineUpdateFriends(); } break;
    }
    case 'friend_request_in':
      ONLINE.requests.push({ from: payload.from, avatar: payload.avatar || '♟' });
      onlineUpdateFriends();
      onlineShowToast(payload.from + ' sent you a friend request', 0x00ccff); break;
    case 'friend_request_sent':
      if (ONLINE.pendingOut.indexOf(payload.to) === -1) ONLINE.pendingOut.push(payload.to);
      onlineUpdateFriends();
      onlineShowToast('Friend request sent to ' + payload.to, 0x00ccff); break;
    case 'friend_accepted':
      ONLINE.friends.push({ username: payload.username, avatar: payload.avatar, elo: payload.elo, status: payload.status || 'idle' });
      ONLINE.requests = ONLINE.requests.filter(function(r) { return r.from !== payload.username; });
      ONLINE.pendingOut = ONLINE.pendingOut.filter(function(u) { return u !== payload.username; });
      onlineUpdateFriends();
      onlineShowToast(payload.username + ' is now your friend!', 0x00ff88); break;
    case 'friend_removed':
      ONLINE.friends = ONLINE.friends.filter(function(f) { return f.username !== payload.username; });
      onlineUpdateFriends(); break;
    case 'friend_cancel_ok':
      ONLINE.pendingOut = ONLINE.pendingOut.filter(function(u) { return u !== payload.to; });
      onlineUpdateFriends(); break;
    case 'friend_err':
      ONLINE.pendingOut = ONLINE.pendingOut.filter(function(u) { return u !== payload.to; });
      onlineUpdateFriends();
      onlineShowToast(payload.msg, 0xff4444); break;
    case 'invite_sent': onlineShowToast('Invite sent to ' + payload.to, 0xffaa00); break;
    case 'invite_expired': onlineShowToast('Invite to ' + payload.to + ' expired', 0x555555); break;
    case 'invite_declined': onlineShowToast(payload.by + ' declined your invite', 0xff4444); break;
    case 'invite_err': onlineShowToast(payload.msg, 0xff4444); break;
    case 'match_invite_in': onlineShowMatchInvite(payload); break;
    case 'avatar_updated':
      if (ONLINE.player) ONLINE.player.avatar = payload.avatar;
      onlineUpdateUI(); break;
    case 'room_created': {
      var _pso2 = document.getElementById('playStepOnline');
      if (_pso2 && _pso2.style.display !== 'none') {
        var _rc = document.getElementById('psoRoomCode'); if (_rc) _rc.textContent = payload.code;
        var _ps = document.getElementById('psoPrivateSection'); if (_ps) _ps.style.display = 'block';
      }
      break;
    }
    case 'room_join_err':
      onlineShowToast(payload.msg || 'Room not found', 0xff4444); break;
    case 'room_expired': {
      var _pso3 = document.getElementById('playStepOnline');
      if (_pso3 && _pso3.style.display !== 'none') {
        var _ps2 = document.getElementById('psoPrivateSection'); if (_ps2) _ps2.style.display = 'none';
      }
      onlineShowToast('Private room expired', 0x555555); break;
    }

    // ── Pool ratings / counts ──────────────────────────────────
    case 'match:searching_count':
      ONLINE.poolCounts = payload.counts || {};
      onlineLobbyUpdateCards();
      break;

    case 'rating:all':
      ONLINE.poolRatings = payload.ratings || {};
      onlineLobbyUpdateCards();
      break;

    case 'rating:data': {
      if (payload.pool) {
        ONLINE.poolRatings[payload.pool] = payload;
        onlineLobbyUpdateCards();
      }
      break;
    }

    // ── Correspondence ────────────────────────────────────────
    case 'corr:seeks_list':
      ONLINE.mySeek = payload.mySeek || null;
      onlineLobbyUpdateSeeks(payload.seeks || []);
      break;

    case 'corr:seek_posted':
      onlineShowToast('Seek posted — waiting for opponent', 0x00ff88);
      break;

    case 'corr:seek_cancelled':
      ONLINE.mySeek = null;
      onlineShowToast('Seek cancelled', 0x555555);
      break;

    case 'corr:games_list':
      ONLINE.corrGames = { myTurn: payload.myTurn || [], theirTurn: payload.theirTurn || [] };
      onlineLobbyUpdateGamesPanel();
      onlineUpdateGamesBadge();
      // Show banner if it's our turn in correspondence games (on login / page return)
      if ((payload.myTurn || []).length > 0) onlineShowCorrTurnBanner(payload.myTurn.length);
      break;

    case 'corr:game_update': {
      var cg = payload.game;
      if (!cg) break;
      // Update in corrGames list
      var _updateCorrList = function(arr) {
        for (var ii = 0; ii < arr.length; ii++) if (arr[ii].gameId === cg.gameId) { arr[ii] = cg; return true; } return false;
      };
      if (!_updateCorrList(ONLINE.corrGames.myTurn) && !_updateCorrList(ONLINE.corrGames.theirTurn)) {
        // New game — add to appropriate list
        if (cg.isMyTurn) ONLINE.corrGames.myTurn.push(cg);
        else ONLINE.corrGames.theirTurn.push(cg);
      } else {
        // Move between lists if turn changed
        ONLINE.corrGames.myTurn   = ONLINE.corrGames.myTurn.filter(function(g) { return g.gameId !== cg.gameId; });
        ONLINE.corrGames.theirTurn = ONLINE.corrGames.theirTurn.filter(function(g) { return g.gameId !== cg.gameId; });
        if (cg.status === 'active') { if (cg.isMyTurn) ONLINE.corrGames.myTurn.push(cg); else ONLINE.corrGames.theirTurn.push(cg); }
      }
      onlineLobbyUpdateGamesPanel();
      onlineUpdateGamesBadge();
      // Update active game if we have it open
      if (ONLINE.corrGame && ONLINE.corrGame.gameId === cg.gameId) {
        ONLINE.corrGame = cg;
        _onlineCorrShowHUD(cg);
        if (cg.isMyTurn) { setGameInputEnabled(true); onlineShowToast("Your turn!", 0x00ff88); }
        else { setGameInputEnabled(false); }
      }
      break;
    }

    case 'corr:game_started': {
      var ng = payload.game;
      if (!ng) break;
      if (ng.isMyTurn) ONLINE.corrGames.myTurn.push(ng);
      else ONLINE.corrGames.theirTurn.push(ng);
      onlineLobbyUpdateGamesPanel();
      onlineUpdateGamesBadge();
      onlineShowToast('Correspondence game started! vs ' + (ng.myColor === 'white' ? ng.blackUser : ng.whiteUser), 0x00ff88);
      break;
    }

    case 'corr:game_data':
      if (payload.game) openCorrGame(payload.game);
      break;
  }
}

async function onlineStartMatch(matchInfo) {
  if (ONLINE.pc) { try { ONLINE.pc.close(); } catch(e) {} }
  if (ONLINE._rtcTimer) { clearTimeout(ONLINE._rtcTimer); ONLINE._rtcTimer = null; }
  var pc = new RTCPeerConnection({ iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ] });
  ONLINE.pc = pc;
  ONLINE._rtcTimer = setTimeout(function() {
    if (ONLINE.pc !== pc) return;
    onlineLog('WebRTC timeout — DataChannel never opened');
    onlineShowToast('Connection failed (NAT/firewall). Returning to queue...', 0xff4444);
    try { pc.close(); } catch(e) {}
    ONLINE.pc = null; ONLINE.dc = null;
    ONLINE.inMatch = false; ONLINE._drawOfferSent = false;
    localStorage.removeItem('cc_pending_match');
    onlineHideColorIndicator();
    ONLINE.setStatus('idle');
  }, 15000);
  pc.onicecandidate = function(ev) {
    if (ev.candidate) onlineSend('signal', { roomId: ONLINE.roomId, signal: { ice: ev.candidate } });
  };
  pc.onconnectionstatechange = function() {
    if (pc.connectionState === 'connected') onlineLog('P2P connected');
    if (pc.connectionState === 'failed')    onlineLog('P2P failed');
  };
  if (ONLINE.myColor === 'white') {
    var dc = pc.createDataChannel('chess');
    ONLINE.dc = dc; onlineWireDataChannel(dc, matchInfo);
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    onlineSend('signal', { roomId: ONLINE.roomId, signal: { sdp: pc.localDescription } });
  } else {
    pc.ondatachannel = function(ev) { ONLINE.dc = ev.channel; onlineWireDataChannel(ev.channel, matchInfo); };
  }
}

async function onlineHandleSignal(signal, from) {
  if (!ONLINE.pc) return;
  var pc = ONLINE.pc;
  try {
    if (signal.sdp) {
      await pc.setRemoteDescription(signal.sdp);
      if (signal.sdp.type === 'offer') {
        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        onlineSend('signal', { roomId: ONLINE.roomId, signal: { sdp: pc.localDescription } });
      }
    } else if (signal.ice) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.ice));
    }
  } catch(e) { onlineLog('Signal error: ' + e.message); }
}

function onlineWireDataChannel(dc, matchInfo) {
  dc.onopen = function() {
    if (ONLINE._rtcTimer) { clearTimeout(ONLINE._rtcTimer); ONLINE._rtcTimer = null; }
    onlineLog('DataChannel open');
    onlineUpdateStatusBar();
    updateSignalIndicator();
    if (matchInfo && !matchInfo.reconnecting) {
      playerColor = ONLINE.myColor; botColor = null;
      arcadeSettings.enabled = (ONLINE.gameMode === 'arcade');
      ctfMode = (ONLINE.gameMode === 'ctf');
      // Parse TC string like "10+3" → 10 min, or "none" → no clock
      var _tcBase = 0;
      if (ONLINE.timeControl && ONLINE.timeControl !== 'none') {
        var _tcParts = ONLINE.timeControl.split('+');
        _tcBase = parseInt(_tcParts[0]) || 0;
      }
      if (_tcBase > 0) { TIME_CONTROL_MINS = _tcBase; timeEnabled = true; } else { timeEnabled = false; }
      startLocalGame(); onlineShowMatchBanner(matchInfo);
      onlineShowColorIndicator(ONLINE.myColor, ONLINE.opponent);
      onlineUpdateThinking();
    } else if (matchInfo && matchInfo.reconnecting) {
      onlineLog('Reconnect DataChannel open — awaiting sync');
    } else {
      // matchInfo === null: surviving player re-established WebRTC — send board state
      onlineDCSend('sync', { moves: history.map(function(h) { return { from: h.from, to: h.to }; }) });
    }
  };
  dc.onmessage = function(ev) {
    var msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'move') {
      var now = Date.now();
      if (now - _dcLastMoveAt < 50) return; // rate-limit: ignore moves faster than 50ms
      if (msg.seq !== undefined && msg.seq !== _dcExpectedSeq + 1) return; // reject out-of-order
      _dcLastMoveAt = now;
      if (msg.seq !== undefined) _dcExpectedSeq = msg.seq;
      var p = pieces.find(function(p) { return p.userData.x===msg.from.x && p.userData.y===msg.from.y && p.userData.z===msg.from.z; });
      if (p) { ONLINE._receivingRemoteMove=true; executeMove(p, msg.to); ONLINE._receivingRemoteMove=false; document.getElementById('hud').textContent = turn.charAt(0).toUpperCase()+turn.slice(1)+' to move'; }
    } else if (msg.type === 'resign') {
      onlineShowToast(ONLINE.opponent.username + ' resigned - you win!', 0x00ff88);
      onlineRecordResult(ONLINE.myColor === 'white' ? 'white_wins' : 'black_wins');
    } else if (msg.type === 'draw_offer') {
      onlineShowDrawOffer();
    } else if (msg.type === 'draw_accept') {
      onlineRecordResult('draw');
    } else if (msg.type === 'draw_decline') {
      ONLINE._drawOfferSent = false;
      onlineShowToast('Draw declined.', 0xff4444);
    } else if (msg.type === 'rematch_request') {
      onlineShowRematchOffer();
    } else if (msg.type === 'rematch_accept') {
      onlineDoRematch();
    } else if (msg.type === 'rematch_decline') {
      var rb2=document.getElementById('rematchBtn');
      if(rb2){rb2.textContent='↺ Rematch'; rb2.disabled=false;}
      onlineShowToast('Opponent declined rematch.', 0xff4444);
    } else if (msg.type === 'sync') {
      playerColor = ONLINE.myColor; botColor = null;
      arcadeSettings.enabled = (ONLINE.gameMode === 'arcade');
      ctfMode = (ONLINE.gameMode === 'ctf');
      startLocalGame();
      ONLINE._syncing = true;
      for (var _si = 0; _si < msg.moves.length; _si++) {
        var _sm = msg.moves[_si];
        var _sp = pieces.find(function(p) { return p.userData.x===_sm.from.x && p.userData.y===_sm.from.y && p.userData.z===_sm.from.z; });
        if (_sp) executeMove(_sp, _sm.to);
      }
      ONLINE._syncing = false;
      onlineUpdateThinking();
      onlineShowToast('Reconnected! Game resumed.', 0x00ff88);
    } else if (msg.type === 'promotion') {
      // Hide wait overlay shown while opponent chose their piece
      var _pw2=document.getElementById('promotionWait'); if(_pw2)_pw2.style.display='none';
      if (promotionActive) {
        // resolvePromotion handles the piece swap when triggered from our own promotePawn wait path
        resolvePromotion(msg.pieceType);
      } else {
        // Opponent promoted a pawn we've already moved (rare re-sync path)
        var promoted = pieces.find(function(q) { return q.userData.x===msg.x && q.userData.y===msg.y && q.userData.z===msg.z; });
        if (promoted && promoted.userData.type !== msg.pieceType) {
          var pc=promoted.userData.color,px=promoted.userData.x,py=promoted.userData.y,pz=promoted.userData.z;
          var np=buildPiece(msg.pieceType,pc);
          np.userData.type=msg.pieceType; np.userData.x=px; np.userData.y=py; np.userData.z=pz; np.userData.moved=true;
          layers[pz].add(np);
          np.position.set(-half+(px+0.5)*SPACING,0,-half+(py+0.5)*SPACING);
          var idx=pieces.indexOf(promoted); if(idx!==-1)pieces.splice(idx,1);
          if(promoted.parent)promoted.parent.remove(promoted);
          pieces.push(np); boardMap[key(px,py,pz)]=np;
        }
      }
      onlineShowToast('Opponent promoted to ' + msg.pieceType + '.', 0xce93d8);
    } else if (msg.type === 'clock_sync') {
      // Snap local clock to sender's authoritative remaining times
      if (timeEnabled && typeof timers !== 'undefined') {
        if (msg.white != null) timers.white = msg.white;
        if (msg.black != null) timers.black = msg.black;
        updateClockDisplay();
      }
    }
  };
  dc.onclose = function() { onlineLog('DataChannel closed'); updateSignalIndicator(); };
}

var _dcSendSeq = 0;
var _dcExpectedSeq = 0;
var _dcLastMoveAt = 0;

function onlineDCSend(type, payload) {
  if (ONLINE.dc && ONLINE.dc.readyState === 'open') {
    var msg = Object.assign({ type: type }, payload || {});
    if (type === 'move') msg.seq = ++_dcSendSeq;
    ONLINE.dc.send(JSON.stringify(msg));
  }
}

var _onlineBaseExec = executeMove;
executeMove = function(piece, t) {
  var wasMyTurn = (turn === playerColor);
  var from = { x: piece.userData.x, y: piece.userData.y, z: piece.userData.z };
  _onlineBaseExec.call(this, piece, t);
  if (ONLINE.inMatch && wasMyTurn && !ONLINE._syncing) {
    onlineDCSend('move', { from: from, to: { x: t.x, y: t.y, z: t.z } });
    if (timeEnabled && typeof timers !== 'undefined')
      onlineDCSend('clock_sync', { white: timers.white, black: timers.black });
  }
  if (ONLINE.inMatch) onlineUpdateThinking();
  // Correspondence: send move to server
  if (ONLINE.corrGame && ONLINE.corrGame.status === 'active' && wasMyTurn && !ONLINE._syncing) {
    var snap = JSON.stringify(pieces.map(function(p) {
      return { type: p.userData.type, color: p.userData.color, x: p.userData.x, y: p.userData.y, z: p.userData.z, moved: p.userData.moved };
    }));
    onlineSend('corr:move', { gameId: ONLINE.corrGame.gameId, move: { from: from, to: { x: t.x, y: t.y, z: t.z } }, snapshot: snap });
    ONLINE.corrGame.isMyTurn = false;
    setGameInputEnabled(false);
  }
};

var _onlineBaseEnd = typeof endGame !== 'undefined' ? endGame : null;
if (_onlineBaseEnd) {
  endGame = function(msg) {
    _onlineBaseEnd(msg);
    if (ONLINE.inMatch) {
      var result = 'draw', lmsg = (msg||'').toLowerCase();
      if (lmsg.includes('white') && lmsg.includes('win')) result = 'white_wins';
      else if (lmsg.includes('black') && lmsg.includes('win')) result = 'black_wins';
      onlineRecordResult(result);
    }
    if (ONLINE.corrGame && ONLINE.corrGame.status === 'active') {
      var lmsg2 = (msg||'').toLowerCase();
      var res2  = 'draw';
      if (lmsg2.includes('white') && lmsg2.includes('win')) res2 = 'white_wins';
      else if (lmsg2.includes('black') && lmsg2.includes('win')) res2 = 'black_wins';
      onlineSend('corr:result', { gameId: ONLINE.corrGame.gameId, result: res2 });
      ONLINE.corrGame.status = res2;
    }
  };
}

function onlineRecordResult(result) {
  if (!ONLINE.inMatch) return;
  onlineSend('game_result', { roomId: ONLINE.roomId, result: result });
  ONLINE.inMatch = false; ONLINE._drawOfferSent = false;
  localStorage.removeItem('cc_pending_match');
  onlineUpdateStatusBar();
  onlineHideColorIndicator();
}

/* -- In-game color indicator: "YOU  WHITE  vs  Opponent" -------- */
var _onlineColorIndicator = null;
function onlineShowColorIndicator(myColor, opponent) {
  if (_onlineColorIndicator) _onlineColorIndicator.remove();
  var el = document.createElement('div');
  el.id = 'onlineColorIndicator';
  var youCol  = myColor === 'white' ? '#ffffff' : '#888888';
  var oppCol  = myColor === 'white' ? '#888888' : '#ffffff';
  var oppName = opponent ? _esc(opponent.avatar||'♟') + ' ' + _esc(opponent.username) : '?';
  var btnStyle = 'background:rgba(0,0,0,0.6);border:1px solid #333;color:#666;'
    + 'font-family:monospace;font-size:8px;padding:2px 7px;cursor:pointer;letter-spacing:1px;'
    + 'transition:border-color 0.15s,color 0.15s;white-space:nowrap;';
  el.style.cssText = 'position:fixed;top:calc(8px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:22;'
    + 'background:rgba(0,0,0,0.72);border:1px solid #222;border-radius:2px;'
    + 'font-family:monospace;font-size:9px;letter-spacing:2px;padding:4px 10px;'
    + 'pointer-events:auto;white-space:nowrap;display:flex;align-items:center;gap:8px;';
  el.innerHTML = '<span style="color:' + youCol + '">YOU (' + myColor.toUpperCase() + ')</span>'
    + '<span style="color:#444">VS</span>'
    + '<span style="color:' + oppCol + '">' + oppName + '</span>'
    + '<span style="color:#222;margin:0 2px;">|</span>'
    + '<button id="_onlineDrawBtn" style="'+btnStyle+'">DRAW</button>'
    + '<button id="_onlineResignBtn" style="'+btnStyle+'color:#7a2a2a;border-color:#3a1010;">RESIGN</button>';
  document.body.appendChild(el);
  _onlineColorIndicator = el;

  el.querySelector('#_onlineDrawBtn').onmouseenter = function() { this.style.color='#ffaa00'; this.style.borderColor='#ffaa00'; };
  el.querySelector('#_onlineDrawBtn').onmouseleave = function() { this.style.color='#666'; this.style.borderColor='#333'; };
  el.querySelector('#_onlineResignBtn').onmouseenter = function() { this.style.color='#ff4444'; this.style.borderColor='#ff4444'; };
  el.querySelector('#_onlineResignBtn').onmouseleave = function() { this.style.color='#7a2a2a'; this.style.borderColor='#3a1010'; };

  el.querySelector('#_onlineDrawBtn').onclick = function() {
    if (!ONLINE.inMatch) return;
    if (ONLINE._drawOfferSent) { onlineShowToast('Draw offer already pending.', 0xffaa00); return; }
    ONLINE._drawOfferSent = true;
    onlineDCSend('draw_offer');
    onlineShowToast('Draw offered — waiting for opponent.', 0xffaa00);
  };
  el.querySelector('#_onlineResignBtn').onclick = function() {
    if (!ONLINE.inMatch) return;
    _onlineConfirm('Resign this game?', function() {
      SND.confirm();
      onlineDCSend('resign');
      onlineRecordResult(ONLINE.myColor==='white'?'black_wins':'white_wins');
      endGame('You resigned.');
    });
  };
}
function onlineHideColorIndicator() {
  if (_onlineColorIndicator) { _onlineColorIndicator.remove(); _onlineColorIndicator = null; }
  onlineHideThinking();
}

/* -- Opponent thinking indicator -------------------------------- */
var _thinkingEl = null;
function onlineShowThinking() {
  if (_thinkingEl) return;
  var el = document.createElement('div');
  el.id = 'onlineThinking';
  el.style.cssText = 'position:fixed;top:calc(12px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);'
    + 'font-family:monospace;font-size:10px;letter-spacing:2px;color:#888;'
    + 'pointer-events:none;z-index:21;animation:onlineThinkPulse 1.4s ease-in-out infinite;';
  el.textContent = 'opponent thinking...';
  document.body.appendChild(el);
  _thinkingEl = el;
  if (!document.getElementById('onlineThinkStyle')) {
    var s = document.createElement('style');
    s.id = 'onlineThinkStyle';
    s.textContent = '@keyframes onlineThinkPulse{0%,100%{opacity:0.25}50%{opacity:0.85}}';
    document.head.appendChild(s);
  }
}
function onlineHideThinking() {
  if (_thinkingEl) { _thinkingEl.remove(); _thinkingEl = null; }
}
function onlineUpdateThinking() {
  if (!ONLINE.inMatch || !playerColor) { onlineHideThinking(); return; }
  if (turn !== playerColor) onlineShowThinking(); else onlineHideThinking();
}

/* -- Bottom status bar (menus only, hidden during gameplay) ---- */
var _onlineStatusBar = (function() {
  var el = document.createElement('div');
  el.id = 'onlineStatusBar';
  el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:24px;z-index:22;'
    + 'background:rgba(0,0,0,0.82);font-family:monospace;font-size:9px;letter-spacing:1px;'
    + 'display:flex;align-items:center;padding:0 12px;gap:14px;pointer-events:none;';
  document.body.appendChild(el);
  return el;
})();

/* -- Left-side status widget (desktop menus only) -------------- */
var _onlineWidget = (function() {
  var el = document.createElement('div');
  el.id = 'onlineWidget';
  el.style.cssText = 'position:fixed;left:12px;top:50%;transform:translateY(-50%);z-index:90;'
    + 'background:rgba(0,0,0,0.75);border:1px solid #2a2a2a;border-radius:3px;'
    + 'font-family:monospace;font-size:9px;letter-spacing:1px;padding:8px 10px;'
    + 'pointer-events:none;line-height:1.8;min-width:80px;';
  document.body.appendChild(el);
  return el;
})();

/* -- Signal strength indicator (in-game network games only) ---- */
var _signalIndicator = (function() {
  var el = document.createElement('div');
  el.id = 'signalIndicator';
  el.title = 'Network signal';
  el.style.cssText = 'position:fixed;top:calc(11px + env(safe-area-inset-top));left:52px;z-index:22;display:none;'
    + 'align-items:flex-end;gap:2px;padding:3px 5px;cursor:default;';
  el.innerHTML = '<svg width="22" height="16" viewBox="0 0 22 16" xmlns="http://www.w3.org/2000/svg">'
    + '<rect class="sb" id="sb1" x="0" y="11" width="4" height="5" rx="1"/>'
    + '<rect class="sb" id="sb2" x="6" y="7"  width="4" height="9" rx="1"/>'
    + '<rect class="sb" id="sb3" x="12" y="3" width="4" height="13" rx="1"/>'
    + '<rect class="sb" id="sb4" x="18" y="0" width="4" height="16" rx="1"/>'
    + '</svg>';
  document.body.appendChild(el);
  return el;
})();

function _updateSignalBars(bars, color) {
  var rects = _signalIndicator.querySelectorAll('rect');
  rects.forEach(function(r, i) { r.setAttribute('fill', i < bars ? color : '#2a2a2a'); });
}

function updateSignalIndicator() {
  _signalIndicator.style.display = (!window._uiHidden && ONLINE.inMatch) ? 'flex' : 'none';
  if (!ONLINE.inMatch) return;
  var p = ONLINE.pingMs;
  if (!p) { _updateSignalBars(1, '#555'); return; }
  var bars = p < 80 ? 4 : p < 200 ? 3 : p < 500 ? 2 : 1;
  _updateSignalBars(bars, bars >= 3 ? '#00ff88' : bars === 2 ? '#ffaa00' : '#ff4444');
}

function onlineUpdateStatusBar() {
  var s = ONLINE._status;
  if (!window._uiHidden) {
    // Hide full status UI during network gameplay; show minimal signal indicator instead
    _onlineStatusBar.style.display = ONLINE.inMatch ? 'none' : 'flex';
    _onlineWidget.style.display    = ONLINE.inMatch ? 'none' : 'block'; // @media handles mobile
  }
  updateSignalIndicator();

  if (ONLINE.inMatch) return; // don't update text content when hidden

  var dot = s==='offline'     ? '<span style="color:#555">- OFFLINE</span>'
          : s==='connecting'  ? '<span style="color:#ffaa00">- CONNECTING</span>'
          : s==='queued'      ? '<span style="color:#ffff00">- SEARCHING-</span>'
          : s==='playing'     ? '<span style="color:#00ff88">- ONLINE GAME</span>'
          : '<span style="color:#00ccff">- ONLINE</span>';
  var elo  = ONLINE.player  ? '<span style="color:#888">ELO '+ONLINE.player.elo+'</span>' : '';
  var opp  = ONLINE.inMatch && ONLINE.opponent ? '<span style="color:#aaa">vs '+ONLINE.opponent.username+'</span>' : '';
  var ping = ONLINE.pingMs  ? '<span style="color:#555">'+ONLINE.pingMs+'ms</span>' : '';
  _onlineStatusBar.innerHTML = dot+(elo?' - '+elo:'')+(opp?' - '+opp:'')+(ping?' - '+ping:'');

  var dotCol = s==='offline' ? '#444' : s==='connecting' ? '#ffaa00' : s==='queued' ? '#ffff00' : s==='playing' ? '#00ff88' : '#00ccff';
  var dotLabel = s==='offline' ? 'OFFLINE' : s==='connecting' ? 'CONNECTING' : s==='queued' ? 'SEARCHING' : s==='playing' ? 'IN GAME' : 'ONLINE';
  var lines = '<div style="color:'+dotCol+'">⬤ '+dotLabel+'</div>';
  if (ONLINE.player) lines += '<div style="color:#aaa">'+ONLINE.player.username+'</div>'
    + '<div style="color:#555">ELO '+ONLINE.player.elo+'</div>';
  if (ONLINE.inMatch && ONLINE.opponent) lines += '<div style="color:#666">vs '+ONLINE.opponent.username+'</div>';
  if (ONLINE.pingMs) lines += '<div style="color:#333">'+ONLINE.pingMs+'ms</div>';
  _onlineWidget.innerHTML = lines;
}
onlineUpdateStatusBar();

setInterval(function() {
  if (!ONLINE.connected) return;
  ONLINE._pingT = Date.now(); onlineSend('ping', {});
}, 30000);

/* -- Wire "Play Online" button --------------------------------- */
document.getElementById('openOnlineBtn').onclick = function() {
  if (typeof SND !== 'undefined') SND.ui();
  document.getElementById('mainMenu').style.display = 'none';
  showOfflineBannerIfStub();
  onlineOpenLobby();
};

/* -- Support overlay ------------------------------------------- */
(function() {
  var overlay = document.createElement('div');
  overlay.id = 'supportOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);display:none;'
    + 'flex-direction:column;justify-content:center;align-items:center;z-index:44;font-family:monospace;color:#cce8ff;';
  overlay.innerHTML = `
    <div style="width:280px;background:rgba(10,12,20,0.95);border:1px solid #0a1e30;border-radius:6px;padding:22px 20px;position:relative;">
      <div style="font-size:15px;letter-spacing:4px;color:#00e5ff;margin-bottom:4px;">SUPPORT</div>
      <div style="font-size:9px;color:#3a7a9b;letter-spacing:2px;margin-bottom:20px;">AURORA CHESS</div>

      <button id="supBugBtn" style="width:100%;background:rgba(10,12,20,0.95);border:1px solid #00e5ff;color:#00e5ff;padding:11px;font-family:monospace;font-size:11px;cursor:pointer;letter-spacing:2px;border-radius:3px;margin-bottom:10px;">
        🐛  REPORT A BUG
      </button>
      <button id="supFeatureBtn" style="width:100%;background:#001a10;border:1px solid #00cc66;color:#00cc66;padding:11px;font-family:monospace;font-size:11px;cursor:pointer;letter-spacing:2px;border-radius:3px;margin-bottom:18px;">
        ✨  SUGGEST A FEATURE
      </button>

      <div style="font-size:9px;color:#3a7a9b;letter-spacing:2px;margin-bottom:6px;">CONTACT</div>
      <a href="mailto:AuroraChess3d@gmail.com" style="display:block;font-size:11px;color:#00e5ff;letter-spacing:1px;text-decoration:none;margin-bottom:18px;">AuroraChess3d@gmail.com</a>

      <div style="font-size:9px;color:#333;line-height:1.8;">
        Aurora Chess &copy; 2025<br>
        <a href="http://100.94.74.5:3000/privacy" target="_blank" rel="noopener" style="color:#333;text-decoration:none;">Privacy Policy</a>
      </div>

      <button id="supCloseBtn" style="position:absolute;top:10px;right:12px;background:none;border:none;color:#3a7a9b;font-size:16px;cursor:pointer;font-family:monospace;line-height:1;">✕</button>
    </div>`;
  document.body.appendChild(overlay);

  function closeSupport() {
    if (typeof SND !== 'undefined') SND.ui();
    overlay.style.display = 'none';
    document.getElementById('mainMenu').style.display = 'flex';
  }

  document.getElementById('mainSupportBtn').onclick = function() {
    if (typeof SND !== 'undefined') SND.ui();
    overlay.style.display = 'flex';
  };
  overlay.querySelector('#supCloseBtn').onclick = closeSupport;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeSupport(); });

  overlay.querySelector('#supBugBtn').onclick = function() {
    var s = encodeURIComponent('Aurora Chess \u2014 Bug Report');
    var b = encodeURIComponent('Describe the bug:\n\n\nSteps to reproduce:\n1.\n2.\n\nExpected:\n\nActual:\n\nDevice / Browser:\n');
    window.open('mailto:AuroraChess3d@gmail.com?subject=' + s + '&body=' + b, '_blank');
  };
  overlay.querySelector('#supFeatureBtn').onclick = function() {
    var s = encodeURIComponent('Aurora Chess \u2014 Feature Request');
    var b = encodeURIComponent('Feature idea:\n\n\nWhy it would be useful:\n');
    window.open('mailto:AuroraChess3d@gmail.com?subject=' + s + '&body=' + b, '_blank');
  };
})();

/* -- New matchmaking lobby ---------------------------------------- */
var _lobbyActiveMode = 'standard';
var _queuedPool = null, _queuedTc = null;

var LOBBY_TCS = [
  { section: 'RAPID', badge: 'rapid', highlight: true, note: '★ recommended for 3D chess', cards: [
    { tc: '10+0',  label: '10',    cat: 'rapid' },
    { tc: '10+3',  label: '10|3',  cat: 'rapid' },
    { tc: '15+10', label: '15|10', cat: 'rapid' },
    { tc: '30+0',  label: '30',    cat: 'rapid' }
  ]},
  { section: 'BLITZ', badge: 'blitz', note: 'Fast for 3D — experienced players recommended', cards: [
    { tc: '3+0',  label: '3',    cat: 'blitz' },
    { tc: '3+2',  label: '3|2',  cat: 'blitz' },
    { tc: '5+0',  label: '5',    cat: 'blitz' },
    { tc: '5+3',  label: '5|3',  cat: 'blitz', minRec: true }
  ]},
  { section: 'CLASSICAL', badge: 'classical', cards: [
    { tc: '30+10', label: '30|10', cat: 'classical' },
    { tc: '60+0',  label: '60',    cat: 'classical' }
  ]},
  { section: 'CORRESPONDENCE', badge: 'correspondence', cards: [
    { tc: '1d',  label: '1 day',   cat: 'correspondence' },
    { tc: '3d',  label: '3 days',  cat: 'correspondence' },
    { tc: '7d',  label: '7 days',  cat: 'correspondence' }
  ], moreCards: [
    { tc: '2d',  label: '2 days',  cat: 'correspondence' },
    { tc: '5d',  label: '5 days',  cat: 'correspondence' },
    { tc: '14d', label: '14 days', cat: 'correspondence' },
    { tc: '30d', label: '30 days', cat: 'correspondence' }
  ]}
];

var BADGE_COLORS = { rapid: '#00ccff', blitz: '#ffaa00', classical: '#00e5ff', correspondence: '#00ff88' };

function _tcId(tc) { return tc.replace(/\+/g,'p').replace(/\|/g,'_'); }

function _buildTcCard(card, badgeCol) {
  var isCorr = (card.cat === 'correspondence');
  return '<div class="tcCard" data-tc="' + card.tc + '" data-cat="' + card.cat + '" style="background:#0a0a0a;border:1px solid #1a1a1a;padding:8px 7px;border-radius:2px;"'
    + (card.minRec ? ' title="Minimum recommended blitz for 3D chess"' : '') + '>'
    + '<div style="font-size:' + (isCorr ? '11px' : '16px') + ';font-family:monospace;color:#fff;line-height:1.1;">' + card.label + '</div>'
    + '<div style="font-size:7px;letter-spacing:1px;color:' + badgeCol + ';border:1px solid ' + badgeCol + '33;display:inline-block;padding:1px 4px;margin:3px 0;">' + card.cat.toUpperCase() + (card.minRec ? ' ★' : '') + '</div><br>'
    + '<div id="cr_' + _tcId(card.tc) + '" style="font-size:10px;color:#00ccff;font-family:monospace;margin:4px 0 2px;">—</div>'
    + '<div id="cc_' + card.cat + '_' + _tcId(card.tc) + '" style="font-size:7px;color:#444;margin-bottom:5px;">—</div>'
    + (isCorr
      ? '<button onclick="onlineCorrCardClick(\'' + card.tc + '\')" style="width:100%;padding:4px;background:#001a0a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">SEEK</button>'
      : '<button onclick="onlineJoinPool(\'' + card.cat + '\',\'' + card.tc + '\')" style="width:100%;padding:4px;background:#1a1a1a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">PLAY</button>')
    + '</div>';
}

function _buildLobbyCardGrid() {
  var html = '';
  LOBBY_TCS.forEach(function(sec, si) {
    var badgeCol = BADGE_COLORS[sec.badge] || '#aaa';
    var secNote  = sec.note ? '<span style="color:' + badgeCol + '44;font-size:7px;margin-left:6px;">' + sec.note + '</span>' : '';
    html += '<div style="margin-bottom:4px;">'
      + '<div style="font-size:8px;color:#444;letter-spacing:2px;margin:10px 0 5px;display:flex;align-items:center;">'
      + '<span style="color:' + (sec.highlight ? badgeCol + '99' : '#444') + ';">' + sec.section + '</span>'
      + secNote + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">';
    sec.cards.forEach(function(card) { html += _buildTcCard(card, badgeCol); });
    html += '</div>';
    // "More time controls" expander for sections with moreCards
    if (sec.moreCards && sec.moreCards.length) {
      var moreId = 'tcMore_' + si;
      html += '<button onclick="var m=document.getElementById(\'' + moreId + '\'),btn=this;var open=m.style.display!==\'none\';m.style.display=open?\'none\':\'grid\';btn.textContent=open?\'More time controls ▾\':\'Less ▴\';"'
        + ' style="margin-top:5px;background:none;border:none;color:#333;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;padding:2px 0;">More time controls ▾</button>'
        + '<div id="' + moreId + '" style="display:none;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px;">';
      sec.moreCards.forEach(function(card) { html += _buildTcCard(card, badgeCol); });
      html += '</div>';
    }
    html += '</div>';
  });
  return html;
}

var _onlineLobby = (function() {
  var el = document.createElement('div');
  el.id = 'onlineLobby';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);display:none;'
    + 'flex-direction:column;justify-content:flex-start;align-items:center;z-index:44;'
    + 'font-family:monospace;color:#fff;overflow-y:auto;padding:12px 0 24px;';
  el.innerHTML = `
    <div style="width:320px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-size:15px;letter-spacing:4px;color:#cce8ff;">ONLINE PLAY</div>
        <div id="onlineLobbyStatus" style="font-size:8px;color:#555;letter-spacing:2px;">CONNECTING</div>
      </div>

      <!-- Auth section -->
      <div id="onlineAuthSection" class="settingSection" style="display:none;">
        <h3 style="color:#555;font-size:9px;letter-spacing:2px;margin:0 0 8px;">ACCOUNT</h3>
        <div style="display:flex;gap:0;margin-bottom:8px;border:1px solid #222;overflow:hidden;border-radius:2px;">
          <button id="authTabLogin" style="flex:1;padding:5px;background:#001833;border:none;color:#00ccff;font-family:monospace;font-size:9px;cursor:pointer;letter-spacing:1px;">LOGIN</button>
          <button id="authTabRegister" style="flex:1;padding:5px;background:#1a1a1a;border:none;color:#555;font-family:monospace;font-size:9px;cursor:pointer;letter-spacing:1px;">REGISTER</button>
        </div>
        <input id="onlineUsernameInput" type="text" placeholder="Username" maxlength="20"
          style="width:100%;background:#1a1a1a;border:1px solid #444;color:#fff;font-family:monospace;
                 font-size:11px;padding:7px 8px;box-sizing:border-box;margin-bottom:6px;outline:none;">
        <div style="position:relative;margin-bottom:6px;">
          <input id="onlinePasswordInput" type="password" placeholder="Password" maxlength="64"
            style="width:100%;background:#1a1a1a;border:1px solid #444;color:#fff;font-family:monospace;
                   font-size:11px;padding:7px 30px 7px 8px;box-sizing:border-box;outline:none;">
          <button id="onlinePwToggle" title="Show/hide password"
            style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:#444;font-size:12px;cursor:pointer;padding:0;line-height:1;">◉</button>
        </div>
        <div id="onlineAvatarRow" style="display:none;margin-bottom:8px;">
          <div style="font-size:8px;color:#444;letter-spacing:1px;margin-bottom:4px;">AVATAR</div>
          <div id="onlineAvatarPicker" style="display:flex;gap:5px;"></div>
        </div>
        <button id="onlineLoginBtn" style="width:100%;background:#1a1a1a;border:1px solid #00ccff;color:#00ccff;font-family:monospace;font-size:10px;padding:7px;cursor:pointer;letter-spacing:1px;margin-bottom:6px;">LOGIN</button>
        <button id="onlineRegisterBtn" style="display:none;width:100%;background:#1a1a1a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:10px;padding:7px;cursor:pointer;letter-spacing:1px;margin-bottom:6px;">CREATE ACCOUNT</button>
        <div style="display:flex;align-items:center;gap:6px;margin:2px 0 6px;">
          <div style="flex:1;height:1px;background:#222;"></div>
          <span style="font-size:8px;color:#333;letter-spacing:1px;">OR</span>
          <div style="flex:1;height:1px;background:#222;"></div>
        </div>
        <button id="onlineGoogleSigninBtn" style="width:100%;background:#1a1a1a;border:1px solid #333;color:#aaa;font-family:monospace;font-size:9px;padding:7px;cursor:pointer;letter-spacing:1px;">G  Sign in with Google</button>
        <div id="onlineAuthError" style="font-size:11px;color:#ff4444;min-height:16px;letter-spacing:1px;margin-top:4px;"></div>
      </div>

      <!-- Google username prompt (new Google accounts) -->
      <div id="onlineGoogleUsernameSection" class="settingSection" style="display:none;">
        <h3 style="color:#555;font-size:9px;letter-spacing:2px;margin:0 0 6px;">CHOOSE USERNAME</h3>
        <div style="font-size:8px;color:#444;margin-bottom:8px;letter-spacing:1px;">Google: <span id="onlineGoogleEmail" style="color:#888;"></span></div>
        <input id="onlineGoogleUsernameInput" type="text" placeholder="Username" maxlength="20"
          style="width:100%;background:#1a1a1a;border:1px solid #444;color:#fff;font-family:monospace;
                 font-size:11px;padding:7px 8px;box-sizing:border-box;margin-bottom:6px;outline:none;">
        <button id="onlineGoogleConfirmBtn" style="width:100%;background:#1a1a1a;border:1px solid #00ccff;color:#00ccff;font-family:monospace;font-size:10px;padding:7px;cursor:pointer;letter-spacing:1px;">CONFIRM</button>
        <div id="onlineGoogleUsernameError" style="font-size:11px;color:#ff4444;min-height:16px;letter-spacing:1px;margin-top:4px;"></div>
      </div>

      <!-- Player info when logged in -->
      <div id="onlinePlayerSection" class="settingSection" style="display:none;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div id="onlinePlayerName" style="font-size:12px;color:#fff;letter-spacing:1px;cursor:pointer;" title="View profile"></div>
            <div id="onlinePlayerElo"  style="font-size:9px;color:#00ccff;letter-spacing:2px;margin-top:2px;"></div>
            <div id="onlinePlayerStats" style="font-size:8px;color:#555;letter-spacing:1px;margin-top:1px;"></div>
          </div>
          <div style="display:flex;gap:5px;align-items:center;">
            <button id="onlineMyProfileBtn" style="background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">PROFILE</button>
            <button id="onlineLogoutBtn" style="background:#1a1a1a;border:1px solid #444;color:#666;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">LOGOUT</button>
          </div>
        </div>
      </div>

      <!-- Main play section -->
      <div id="onlinePlaySection" style="display:none;">

        <!-- Mode tabs -->
        <div style="display:flex;gap:3px;margin-bottom:10px;">
          <button data-lobbymode="standard" onclick="onlineLobbySetMode('standard')" style="flex:1;padding:6px;background:#001a2a;border:1px solid #00ccff;color:#00ccff;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">STANDARD</button>
          <button data-lobbymode="arcade"   onclick="onlineLobbySetMode('arcade')"   style="flex:1;padding:6px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">ARCADE</button>
          <button data-lobbymode="flag"     onclick="onlineLobbySetMode('flag')"     style="flex:1;padding:6px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">FLAG</button>
        </div>

        <!-- Time control grid -->
        <div id="onlineTCGrid"></div>

        <!-- Correspondence seeks board (shown when viewing corr section) -->
        <div id="onlineSeeksSection" style="display:none;margin-top:10px;">
          <div style="font-size:9px;color:#444;letter-spacing:2px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
            <span>OPEN SEEKS</span>
            <button id="onlineSeeksRefreshBtn" style="background:none;border:none;color:#333;font-family:monospace;font-size:8px;cursor:pointer;">↻ refresh</button>
          </div>
          <div id="onlineMySeekBar" style="background:#001a0a;border:1px solid #00ff8833;padding:6px 8px;margin-bottom:6px;font-size:8px;color:#00ff88;display:none;justify-content:space-between;align-items:center;">
            <span>Your seek is posted</span>
            <button id="onlineCancelSeekBtn" style="background:#1a1a1a;border:1px solid #444;color:#ff4444;font-family:monospace;font-size:8px;padding:2px 8px;cursor:pointer;">CANCEL</button>
          </div>
          <div id="onlineSeeksList" style="max-height:180px;overflow-y:auto;font-size:8px;"></div>
        </div>

        <!-- Preferences (collapsible) -->
        <div style="margin-top:10px;border-top:1px solid #111;padding-top:8px;">
          <button id="onlinePrefsToggle" style="background:none;border:none;color:#333;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;padding:0;">Preferences ▾</button>
          <div id="onlinePrefContent" style="display:none;margin-top:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:8px;color:#555;letter-spacing:1px;">ELO RANGE</span>
              <select id="onlineEloRangePref" style="background:#1a1a1a;border:1px solid #333;color:#aaa;font-family:monospace;font-size:9px;padding:3px 6px;outline:none;cursor:pointer;">
                <option value="100">± 100</option>
                <option value="150" selected>± 150 (default)</option>
                <option value="200">± 200</option>
                <option value="300">± 300</option>
                <option value="0">Any</option>
              </select>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:8px;color:#555;letter-spacing:1px;">RANKED</span>
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                <input type="checkbox" id="onlineRankedToggle" checked style="accent-color:#00ccff;width:12px;height:12px;">
                <span id="onlineRankedLabel" style="font-size:8px;color:#00ccff;letter-spacing:1px;">ON</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Searching section (shown while in queue) -->
      <div id="onlineSearchingSection" style="display:none;text-align:center;padding:20px 0;">
        <div style="font-size:11px;color:#00ff88;letter-spacing:4px;margin-bottom:6px;">SEARCHING</div>
        <div id="onlineSearchTC"    style="font-size:14px;color:#fff;margin-bottom:2px;"></div>
        <div id="onlineSearchPool"  style="font-size:8px;color:#555;letter-spacing:2px;margin-bottom:14px;"></div>
        <div id="onlineSearchRange" style="font-size:9px;color:#888;letter-spacing:1px;margin-bottom:4px;"></div>
        <div id="onlineSearchTimer" style="font-size:22px;color:#00ff88;font-family:monospace;margin:10px 0;"></div>
        <div id="onlineSearchCount" style="font-size:8px;color:#444;margin-bottom:16px;"></div>
        <button id="onlineCancelSearchBtn" style="padding:8px 24px;background:#1a1a1a;border:1px solid #ff4444;color:#ff4444;font-family:monospace;font-size:10px;cursor:pointer;letter-spacing:2px;">CANCEL</button>
      </div>

      <!-- Leaderboard panel -->
      <div id="onlineLbSection" style="display:none;">
        <div style="font-size:9px;color:#555;letter-spacing:2px;margin-bottom:10px;">LEADERBOARD</div>
        <div id="onlineLbContent" style="font-size:9px;color:#aaa;line-height:2;max-height:280px;overflow-y:auto;"></div>
        <button id="onlineLbBack" style="margin-top:10px;background:#1a1a1a;border:1px solid #333;color:#666;font-family:monospace;font-size:9px;padding:5px 14px;cursor:pointer;">← Back</button>
      </div>

      <!-- Game history panel (kept for _lobbyShowSection compatibility) -->
      <div id="onlineHistorySection" style="display:none;"></div>

      <!-- Friends panel -->
      <div id="onlineFriendsSection" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="font-size:9px;color:#555;letter-spacing:2px;">FRIENDS</div>
          <button id="onlineFriendsBack" style="background:#1a1a1a;border:1px solid #333;color:#666;font-family:monospace;font-size:8px;padding:3px 10px;cursor:pointer;">← Back</button>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:10px;">
          <input id="onlineFriendInput" type="text" placeholder="Add by username" maxlength="20"
            style="flex:1;background:#1a1a1a;border:1px solid #333;color:#aaa;font-family:monospace;font-size:10px;padding:5px 8px;outline:none;">
          <button id="onlineFriendAddBtn" style="background:#1a1a1a;border:1px solid #00ccff;color:#00ccff;font-family:monospace;font-size:9px;padding:5px 10px;cursor:pointer;white-space:nowrap;">+ ADD</button>
        </div>
        <div id="onlineFriendRequests" style="margin-bottom:6px;"></div>
        <div id="onlineFriendList" style="max-height:220px;overflow-y:auto;"></div>
      </div>

      <!-- Your Games panel (active corr + history + saved) -->
      <div id="onlineCorrGamesSection" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:9px;color:#555;letter-spacing:2px;">YOUR GAMES</div>
          <button id="onlineCorrGamesBack" style="background:#1a1a1a;border:1px solid #333;color:#666;font-family:monospace;font-size:8px;padding:3px 10px;cursor:pointer;">← Back</button>
        </div>
        <!-- Sub-tabs -->
        <div style="display:flex;gap:2px;margin-bottom:8px;">
          <button id="ygTabActive"   onclick="_ygTab('active')"  style="flex:1;padding:4px;background:#001a0a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:7px;cursor:pointer;letter-spacing:1px;">ACTIVE</button>
          <button id="ygTabHistory"  onclick="_ygTab('history')" style="flex:1;padding:4px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:7px;cursor:pointer;letter-spacing:1px;">HISTORY</button>
          <button id="ygTabSaved"    onclick="_ygTab('saved')"   style="flex:1;padding:4px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:7px;cursor:pointer;letter-spacing:1px;">SAVED</button>
        </div>
        <!-- Active games -->
        <div id="ygPanelActive"  style="max-height:300px;overflow-y:auto;font-size:9px;"></div>
        <!-- History -->
        <div id="ygPanelHistory" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:7px;color:#444;letter-spacing:1px;">FINISHED GAMES</span>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:7px;color:#444;letter-spacing:1px;">
              <input type="checkbox" id="ygReviewFilter" onchange="_ygApplyHistoryFilter()" style="accent-color:#00e5ff;width:10px;height:10px;"> REVIEW ONLY
            </label>
          </div>
          <div id="ygHistoryContent" style="max-height:270px;overflow-y:auto;font-size:9px;"></div>
        </div>
        <!-- Saved games -->
        <div id="ygPanelSaved"   style="display:none;max-height:300px;overflow-y:auto;font-size:9px;"></div>
      </div>

      <!-- Bottom nav -->
      <div id="onlineLobbyNav" style="display:flex;gap:3px;margin-top:12px;border-top:1px solid #111;padding-top:10px;">
        <button id="onlineLbBtn"       style="flex:1;padding:6px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">LB</button>
        <button id="onlineCorrGamesBtn" style="flex:1;padding:6px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">GAMES</button>
        <button id="onlineFriendsBtn"  style="flex:1;padding:6px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">FRIENDS</button>
      </div>

      <!-- Advanced / server -->
      <div style="margin-top:10px;border-top:1px solid #111;padding-top:8px;">
        <button id="onlineAdvToggle" style="background:none;border:none;color:#2a2a2a;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;padding:0;">Advanced ▾</button>
        <div id="onlineAdvSection" style="display:none;margin-top:8px;">
          <div style="display:flex;gap:6px;">
            <input id="onlineServerInput" type="text" placeholder="ws://192.168.x.x:3000"
              style="flex:1;background:#1a1a1a;border:1px solid #333;color:#aaa;font-family:monospace;font-size:9px;padding:5px 7px;outline:none;">
            <button id="onlineConnectBtn" style="background:#1a1a1a;border:1px solid #444;color:#00ccff;font-family:monospace;font-size:9px;padding:5px 10px;cursor:pointer;white-space:nowrap;">Connect</button>
          </div>
        </div>
      </div>

      <button id="onlineLobbyBack" class="modeBtn" style="margin-top:10px;width:100%;">← Back</button>
    </div>
  `;
  document.body.appendChild(el);
  // Build card grid
  el.querySelector('#onlineTCGrid').innerHTML = _buildLobbyCardGrid();
  return el;
})();

/* -- Wire lobby buttons ---------------------------------------- */
function _lobbyShowSection(id) {
  ['onlinePlaySection','onlineSearchingSection','onlineLbSection','onlineHistorySection',
   'onlineFriendsSection','onlineCorrGamesSection'].forEach(function(s) {
    var el2 = document.getElementById(s);
    if (el2) el2.style.display = (s === id) ? 'block' : 'none';
  });
  var nav = document.getElementById('onlineLobbyNav');
  if (nav) nav.style.display = (id === 'onlinePlaySection' || id === 'onlineSearchingSection') ? 'flex' : 'none';
}

document.getElementById('onlineAdvToggle').onclick = function() {
  var s = document.getElementById('onlineAdvSection'), shown = s.style.display !== 'none';
  s.style.display = shown ? 'none' : 'block';
  this.textContent = shown ? 'Advanced ▾' : 'Advanced ▴';
};
document.getElementById('onlineConnectBtn').onclick = function() {
  var url = document.getElementById('onlineServerInput').value.trim();
  if (!url) return;
  if (!url.startsWith('ws')) url = 'ws://' + url;
  onlineConnect(url);
};
// Auth tab switching
document.getElementById('authTabLogin').onclick = function() { _onlineAuthTab('login'); };
document.getElementById('authTabRegister').onclick = function() { _onlineAuthTab('register'); };

// Password show/hide
document.getElementById('onlinePwToggle').onclick = function() {
  var inp = document.getElementById('onlinePasswordInput');
  var showing = inp.type === 'text';
  inp.type = showing ? 'password' : 'text';
  this.style.color = showing ? '#444' : '#00ccff';
};

// Build avatar picker
(function() {
  var avatars = ['♟','♞','♝','♜','♛','♚'];
  var picker = document.getElementById('onlineAvatarPicker');
  window._onlineSelectedAvatar = '♟';
  avatars.forEach(function(av) {
    var btn = document.createElement('button');
    btn.textContent = av;
    btn.style.cssText = 'font-size:20px;background:#1a1a1a;border:2px solid ' + (av === '♟' ? '#00ccff' : '#222')
      + ';cursor:pointer;padding:3px 6px;border-radius:2px;color:#fff;';
    btn.onclick = function() {
      picker.querySelectorAll('button').forEach(function(b) { b.style.borderColor = '#222'; });
      this.style.borderColor = '#00ccff';
      window._onlineSelectedAvatar = av;
    };
    picker.appendChild(btn);
  });
})();

document.getElementById('onlineLoginBtn').onclick = function() {
  var u = document.getElementById('onlineUsernameInput').value.trim();
  var pw = document.getElementById('onlinePasswordInput').value;
  if (!u) { onlineShowAuthError('Enter a username'); return; }
  onlineSend('login', { username: u, password: pw });
};
document.getElementById('onlineRegisterBtn').onclick = function() {
  var u = document.getElementById('onlineUsernameInput').value.trim();
  var pw = document.getElementById('onlinePasswordInput').value;
  if (!u) { onlineShowAuthError('Enter a username'); return; }
  if (!pw) { onlineShowAuthError('Enter a password'); return; }
  if (pw.length < 4) { onlineShowAuthError('Password must be at least 4 characters'); return; }
  onlineSend('register', { username: u, password: pw, avatar: window._onlineSelectedAvatar || '♟' });
};

// Enter key submits login/register
['onlineUsernameInput', 'onlinePasswordInput'].forEach(function(id) {
  document.getElementById(id).addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    var loginBtn = document.getElementById('onlineLoginBtn');
    if (loginBtn.style.display !== 'none') loginBtn.click();
    else document.getElementById('onlineRegisterBtn').click();
  });
});

// Google sign-in
document.getElementById('onlineGoogleSigninBtn').onclick = function() { _onlineGoogleSignin(); };

// Google username confirm (new accounts)
document.getElementById('onlineGoogleConfirmBtn').onclick = function() {
  var u = document.getElementById('onlineGoogleUsernameInput').value.trim();
  var errEl = document.getElementById('onlineGoogleUsernameError');
  if (!u) { if (errEl) errEl.textContent = 'Enter a username'; return; }
  if (errEl) errEl.textContent = '';
  onlineSend('google_register', {
    googleId: window._onlineGooglePendingId,
    email: window._onlineGooglePendingEmail,
    username: u,
    avatar: '♟'
  });
};
document.getElementById('onlineGoogleUsernameInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('onlineGoogleConfirmBtn').click();
});
document.getElementById('onlineLogoutBtn').onclick = function() {
  localStorage.removeItem('cc_online_username');
  localStorage.removeItem('cc_online_token');
  ONLINE.loggedIn = false; ONLINE.player = null;
  ONLINE.friends = []; ONLINE.requests = []; ONLINE.pendingOut = [];
  ONLINE.poolRatings = {}; ONLINE.corrGames = { myTurn: [], theirTurn: [] };
  onlineUpdateFriends(); onlineUpdateUI();
};
document.getElementById('onlineRankedToggle').onchange = function() {
  var on = this.checked;
  document.getElementById('onlineRankedLabel').textContent = on ? 'ON' : 'OFF';
  document.getElementById('onlineRankedLabel').style.color = on ? '#00ccff' : '#555';
};
document.getElementById('onlinePrefsToggle').onclick = function() {
  var s = document.getElementById('onlinePrefContent'), shown = s.style.display !== 'none';
  s.style.display = shown ? 'none' : 'block';
  this.textContent = shown ? 'Preferences ▾' : 'Preferences ▴';
};
document.getElementById('onlineLbBtn').onclick = function() { onlineLoadLeaderboard(); };
document.getElementById('onlineLbBack').onclick = function() { _lobbyShowSection('onlinePlaySection'); };
document.getElementById('onlineFriendsBtn').onclick = function() {
  _lobbyShowSection('onlineFriendsSection'); onlineUpdateFriends();
};
document.getElementById('onlineFriendsBack').onclick = function() { _lobbyShowSection('onlinePlaySection'); };
document.getElementById('onlineCorrGamesBtn').onclick = function() {
  _lobbyShowSection('onlineCorrGamesSection'); _ygTab('active'); onlineLobbyUpdateGamesPanel();
};
document.getElementById('onlineCorrGamesBack').onclick = function() { _lobbyShowSection('onlinePlaySection'); };
document.getElementById('onlineFriendAddBtn').onclick = function() {
  var u = document.getElementById('onlineFriendInput').value.trim();
  if (!u) return; onlineSend('friend_add', { username: u });
  document.getElementById('onlineFriendInput').value = '';
};
document.getElementById('onlineFriendInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('onlineFriendAddBtn').click();
});
document.getElementById('onlineMyProfileBtn').onclick = function() {
  if (ONLINE.player) onlineOpenProfile(ONLINE.player.username);
};
document.getElementById('onlinePlayerName').onclick = function() {
  if (ONLINE.player) onlineOpenProfile(ONLINE.player.username);
};
document.getElementById('onlineLobbyBack').onclick = function() {
  _onlineLobby.style.display = 'none';
  document.getElementById('mainMenu').style.display = 'flex';
  if (_queued) { _queued = false; onlineSend('match:leave', {}); }
};
document.getElementById('onlineCancelSearchBtn').onclick = function() {
  _queued = false; _queuedPool = null; _queuedTc = null;
  clearInterval(_queueTimerRef);
  onlineSend('match:leave', {});
  _lobbyShowSection('onlinePlaySection');
};
document.getElementById('onlineSeeksRefreshBtn').onclick = function() {
  onlineSend('corr:seeks_list', {});
};
document.getElementById('onlineCancelSeekBtn').onclick = function() {
  onlineSend('corr:seek_cancel', {}); ONLINE.mySeek = null;
  var bar = document.getElementById('onlineMySeekBar');
  if (bar) bar.style.display = 'none';
};

(function() {
  var stored = localStorage.getItem('cc_server_url') || ONLINE_SERVER;
  if (stored) document.getElementById('onlineServerInput').value = stored;
})();

// ── Lobby functions ──────────────────────────────────────────
function onlineLobbySetMode(mode) {
  _lobbyActiveMode = mode;
  document.querySelectorAll('[data-lobbymode]').forEach(function(b) {
    var active = b.dataset.lobbymode === mode;
    b.style.borderColor = active ? '#00ccff' : '#222';
    b.style.color       = active ? '#00ccff' : '#555';
    b.style.background  = active ? '#001a2a' : '#1a1a1a';
  });
  onlineLobbyUpdateCards();
}

function onlineLobbyUpdateCards() {
  var mode = _lobbyActiveMode || 'standard';
  LOBBY_TCS.forEach(function(sec) {
    sec.cards.forEach(function(card) {
      var pool  = mode + '_' + card.cat;
      var tcKey = _tcId(card.tc);
      // Rating element
      var ratEl = document.getElementById('cr_' + tcKey);
      if (ratEl) {
        var pr = ONLINE.poolRatings[pool];
        if (pr && pr.games !== undefined) {
          var prov = (pr.games || 0) < 10;
          ratEl.textContent = (pr.rating || 1200) + (prov ? '?' : '');
          ratEl.style.color = '#00ccff';
        } else {
          ratEl.textContent = '—';
          ratEl.style.color = '#333';
        }
      }
      // Count element — per pool (same for all TCs in same category)
      var cntEl = document.getElementById('cc_' + card.cat + '_' + tcKey);
      if (cntEl) {
        if (card.cat === 'correspondence') {
          var totalCorr = (ONLINE.corrGames.myTurn.length || 0) + (ONLINE.corrGames.theirTurn.length || 0);
          if (totalCorr > 0) {
            cntEl.textContent = totalCorr + ' active game' + (totalCorr > 1 ? 's' : '');
            cntEl.style.color = '#00ff8844';
          } else {
            cntEl.textContent = 'no active games';
            cntEl.style.color = '#2a2a2a';
          }
        } else {
          var cnt = (ONLINE.poolCounts || {})[pool] || 0;
          cntEl.textContent = cnt > 0 ? '~ ' + cnt + ' searching' : 'no one searching';
          cntEl.style.color = cnt > 0 ? '#00ff8844' : '#2a2a2a';
        }
      }
    });
  });
}

function onlineJoinPool(cat, tc) {
  if (!ONLINE.loggedIn) { onlineShowToast('Login first', 0xff4444); return; }
  if (_queued) return;
  var mode     = _lobbyActiveMode || 'standard';
  var pool     = mode + '_' + cat;
  var eloRange = parseInt(document.getElementById('onlineEloRangePref').value) || 150;
  var ranked   = document.getElementById('onlineRankedToggle').checked;
  // Block bullet (under 3 min no increment)
  if (tc !== 'none') {
    var parts = tc.split('+'), base = parseInt(parts[0]), inc = parseInt(parts[1]||'0');
    if (base < 3 || (base === 3 && inc === 0 && cat === 'blitz')) {
      if (base + 30 * inc / 60 < 3) {
        onlineShowToast('Bullet not supported — too fast for 3D chess', 0xff4444); return;
      }
    }
  }
  _queued = true; _queuedPool = pool; _queuedTc = tc;
  onlineSend('match:join', { timeControl: tc, gameMode: mode === 'flag' ? 'ctf' : mode, ranked: ranked, eloRange: eloRange });
  _lobbyShowSection('onlineSearchingSection');
  // Display what we're searching for
  var tcLabel = tc.replace('+','|');
  document.getElementById('onlineSearchTC').textContent   = tcLabel;
  document.getElementById('onlineSearchPool').textContent = mode.toUpperCase() + ' · ' + cat.toUpperCase();
  _queuedEloRange = eloRange;
  onlineQueueTimer();
}

function onlineCorrCardClick(tc) {
  if (!ONLINE.loggedIn) { onlineShowToast('Login first', 0xff4444); return; }
  var secsMap = { '1d': 86400, '2d': 172800, '3d': 259200, '5d': 432000, '7d': 604800, '14d': 1209600, '30d': 2592000 };
  var secs = secsMap[tc] || (parseInt(tc) * 86400) || 86400;
  var mode = _lobbyActiveMode || 'standard';
  // Show seeks section for this TC
  var seeksEl = document.getElementById('onlineSeeksSection');
  if (seeksEl) seeksEl.style.display = 'block';
  // If user has no seek, offer to post one
  if (!ONLINE.mySeek) {
    onlineSend('corr:seek_post', { timePerMove: secs, colorPref: 'random', gameMode: mode === 'flag' ? 'ctf' : mode });
  }
  onlineSend('corr:seeks_list', {});
}

function onlineLobbyUpdateSeeks(seeks) {
  var seeksEl = document.getElementById('onlineSeeksSection');
  if (!seeksEl || seeksEl.style.display === 'none') return;
  var myBar = document.getElementById('onlineMySeekBar');
  if (myBar) myBar.style.display = ONLINE.mySeek ? 'flex' : 'none';
  var listEl = document.getElementById('onlineSeeksList');
  if (!listEl) return;
  if (!seeks.length) {
    listEl.innerHTML = '<div style="color:#2a2a2a;padding:8px 0;">No open seeks — your seek has been posted, waiting for an opponent.</div>';
    return;
  }
  listEl.innerHTML = '<table style="width:100%;border-collapse:collapse;">'
    + '<tr style="color:#333;font-size:7px;letter-spacing:1px;border-bottom:1px solid #111;">'
    + '<td style="padding:4px 2px;">PLAYER</td><td style="padding:4px 2px;">RATING</td>'
    + '<td style="padding:4px 2px;">TIME/MOVE</td><td style="padding:4px 2px;">COLOR</td><td></td></tr>'
    + seeks.map(function(s) {
        var dayLabel = Math.round(s.timePerMove / 86400) + 'd';
        var prov = (s.games || 0) < 10;
        return '<tr style="border-bottom:1px solid #0a0a0a;font-size:8px;color:#888;">'
          + '<td style="padding:5px 2px;">' + _esc(s.avatar || '♟') + ' ' + _esc(s.username) + '</td>'
          + '<td style="padding:5px 2px;color:#00ccff;">' + (s.rating||1200) + (prov?'?':'') + '</td>'
          + '<td style="padding:5px 2px;">' + dayLabel + '</td>'
          + '<td style="padding:5px 2px;color:#555;">' + (s.colorPref||'random') + '</td>'
          + '<td style="padding:5px 2px;"><button onclick="onlineSend(\'corr:seek_accept\',{seekId:\'' + s.seekId + '\'})" style="background:#001a0a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:7px;padding:2px 6px;cursor:pointer;">ACCEPT</button></td>'
          + '</tr>';
      }).join('')
    + '</table>';
}

function onlineUpdateGamesBadge() {
  var n = ONLINE.corrGames.myTurn.length;
  var btn = document.getElementById('onlineCorrGamesBtn');
  if (btn) {
    btn.textContent = n > 0 ? 'GAMES (' + n + ')' : 'GAMES';
    btn.style.color = n > 0 ? '#00ff88' : '#555';
    btn.style.borderColor = n > 0 ? '#00ff8844' : '#222';
  }
}

/* ── Your Games sub-tab switching ── */
var _ygCurrentTab = 'active';
function _ygTab(tab) {
  _ygCurrentTab = tab;
  ['active','history','saved'].forEach(function(t) {
    var btn = document.getElementById('ygTab' + t.charAt(0).toUpperCase() + t.slice(1));
    var panel = document.getElementById('ygPanel' + t.charAt(0).toUpperCase() + t.slice(1));
    var active = (t === tab);
    if (btn) {
      btn.style.background    = active ? (t === 'active' ? '#001a0a' : t === 'history' ? '#1a000a' : '#0a001a') : '#1a1a1a';
      btn.style.borderColor   = active ? (t === 'active' ? '#00ff88' : t === 'history' ? '#ff6688' : '#8866ff') : '#222';
      btn.style.color         = active ? (t === 'active' ? '#00ff88' : t === 'history' ? '#ff6688' : '#8866ff') : '#555';
    }
    if (panel) panel.style.display = active ? 'block' : 'none';
  });
  if (tab === 'history') _ygLoadHistory();
  if (tab === 'saved')   _ygLoadSaved();
}

/* ── History tab ── */
var _ygHistoryCache = null;
function _ygLoadHistory() {
  if (!ONLINE.player) {
    document.getElementById('ygHistoryContent').innerHTML = '<div style="color:#333;padding:12px 0;text-align:center;">Log in to see history</div>';
    return;
  }
  var el = document.getElementById('ygHistoryContent');
  el.textContent = 'Loading...';
  var url = (localStorage.getItem('cc_server_url')||'').replace('ws://','http://').replace('wss://','https://');
  fetch(url + '/player/' + encodeURIComponent(ONLINE.player.username) + '/history')
    .then(function(r) { return r.json(); })
    .then(function(games) {
      _ygHistoryCache = games;
      _ygApplyHistoryFilter();
    })
    .catch(function() { el.textContent = 'Could not load.'; });
}

function _ygApplyHistoryFilter() {
  var el = document.getElementById('ygHistoryContent');
  if (!_ygHistoryCache) { _ygLoadHistory(); return; }
  var reviewOnly = document.getElementById('ygReviewFilter') && document.getElementById('ygReviewFilter').checked;
  var reviewSet  = _ygGetReviewSet();
  var games = reviewOnly ? _ygHistoryCache.filter(function(g) { return reviewSet.has(g.played_at); }) : _ygHistoryCache;
  if (!games.length) {
    el.innerHTML = '<div style="color:#333;padding:12px 0;text-align:center;">' + (reviewOnly ? 'No reviewed games' : 'No games recorded yet.') + '</div>';
    return;
  }
  el.innerHTML = games.map(function(g) {
    var resColor = g.result === 'win' ? '#00ff88' : g.result === 'loss' ? '#ff4444' : '#ffaa00';
    var delta    = g.delta != null ? (g.delta > 0 ? '+' : '') + g.delta : '';
    var date     = new Date(g.played_at).toLocaleDateString(undefined, { month:'short', day:'numeric' });
    var mode     = g.game_mode !== 'standard' ? ' [' + g.game_mode.toUpperCase() + ']' : '';
    var rated    = g.rated ? '' : ' <span style="color:#333;">(unrated)</span>';
    var opp      = _esc((g.opponent_avatar||'♟') + ' ' + (g.opponent||'?'));
    var hasRev   = reviewSet.has(g.played_at);
    var revBtn   = '<button onclick="_ygToggleReview(\'' + g.played_at.replace(/'/g,"\\'") + '\')" title="' + (hasRev ? 'Remove review' : 'Save for review') + '" style="background:none;border:none;font-size:10px;cursor:pointer;padding:0 2px;opacity:' + (hasRev ? '1' : '0.3') + ';">🔖</button>';
    return '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #111;padding:4px 0;">'
      + '<span style="flex:1;min-width:0;">'
        + '<span style="color:' + resColor + ';text-transform:uppercase;">' + g.result + '</span>'
        + '  <span style="cursor:pointer;" onclick="onlineOpenProfile(\'' + (g.opponent||'').replace(/'/g,"\\'") + '\')">' + opp + '</span>' + mode + rated
      + '</span>'
      + '<span style="display:flex;align-items:center;gap:4px;color:#555;white-space:nowrap;">'
        + (delta ? '<span style="color:' + resColor + ';">' + delta + '</span>' : '')
        + '<span>' + date + '</span>'
        + revBtn
      + '</span>'
      + '</div>';
  }).join('');
}

function _ygGetReviewSet() {
  try { return new Set(JSON.parse(localStorage.getItem('cc_review_games') || '[]')); } catch(e) { return new Set(); }
}
function _ygToggleReview(playedAt) {
  var s = _ygGetReviewSet();
  if (s.has(playedAt)) s.delete(playedAt); else s.add(playedAt);
  localStorage.setItem('cc_review_games', JSON.stringify([...s]));
  _ygApplyHistoryFilter();
}

/* ── Saved tab ── */
function _ygLoadSaved() {
  var el = document.getElementById('ygPanelSaved');
  if (!el) return;
  var saves = (typeof savesForUser === 'function' && typeof ACC_active !== 'undefined' && ACC_active)
    ? savesForUser(ACC_active.username) : [];
  if (!saves.length) {
    el.innerHTML = '<div style="color:#333;padding:12px 0;text-align:center;">No saved games</div>';
    return;
  }
  el.innerHTML = saves.map(function(s) {
    var dateStr = new Date(s.date).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    return '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #111;padding:5px 0;">'
      + '<div style="flex:1;min-width:0;">'
        + '<div style="color:#ccc;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(s.label) + '</div>'
        + '<div style="color:#444;font-size:8px;">' + _esc(dateStr) + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:4px;">'
        + '<button onclick="(function(){var sv=(typeof savesForUser===\'function\'&&typeof ACC_active!==\'undefined\'&&ACC_active)?savesForUser(ACC_active.username).find(function(x){return x.id===\'' + s.id + '\';}):null;if(sv&&typeof gameLoad===\'function\')gameLoad(sv);})()" style="background:#001a2a;border:1px solid #00ccff;color:#00ccff;font-family:monospace;font-size:7px;padding:2px 8px;cursor:pointer;">LOAD</button>'
        + '<button onclick="if(typeof gameDelete===\'function\')gameDelete(\'' + s.id + '\');_ygLoadSaved();" style="background:#1a1a1a;border:1px solid #333;color:#666;font-family:monospace;font-size:7px;padding:2px 6px;cursor:pointer;">✕</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

function onlineLobbyUpdateGamesPanel() {
  var myT    = ONLINE.corrGames.myTurn   || [];
  var theirT = ONLINE.corrGames.theirTurn || [];
  var el = document.getElementById('ygPanelActive');
  if (!el) return;
  if (!myT.length && !theirT.length) {
    el.innerHTML = '<div style="color:#2a2a2a;padding:16px 0;text-align:center;">No active correspondence games</div>';
    return;
  }
  var secStyle = 'font-size:8px;color:#444;letter-spacing:2px;margin:10px 0 6px;';
  var html = '';
  if (myT.length) {
    html += '<div style="' + secStyle + '">YOUR TURN (' + myT.length + ')</div>';
    html += myT.map(function(g) { return _corrGameRow(g, true); }).join('');
  }
  if (theirT.length) {
    html += '<div style="' + secStyle + (myT.length ? ';margin-top:14px;' : '') + '">WAITING (' + theirT.length + ')</div>';
    html += theirT.map(function(g) { return _corrGameRow(g, false); }).join('');
  }
  el.innerHTML = html;
}

function _corrGameRow(g, myTurn) {
  var opp    = g.myColor === 'white' ? g.blackUser : g.whiteUser;
  var rem    = g.isMyTurn ? g.whiteClockRemaining : g.blackClockRemaining;
  var days   = Math.max(0, Math.floor(rem / 86400000));
  var hrs    = Math.max(0, Math.floor((rem % 86400000) / 3600000));
  var remStr = days > 0 ? days + 'd ' + hrs + 'h' : hrs + 'h';
  var modeStr = (g.gameMode !== 'standard' && g.gameMode) ? ' [' + g.gameMode.toUpperCase() + ']' : '';
  var borderCol = myTurn ? '#00ff88' : '#1a1a1a';
  return '<div style="border:1px solid ' + borderCol + ';padding:8px;margin-bottom:5px;border-radius:2px;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;">'
    + '<div>'
    + '<div style="font-size:9px;color:#fff;">' + _esc(opp) + modeStr + '</div>'
    + '<div style="font-size:8px;color:#555;">Move ' + (g.moveCount||0) + ' · ' + (g.timePerMoveSeconds/86400|0) + 'd/move</div>'
    + '</div>'
    + '<div style="text-align:right;">'
    + '<div style="font-size:8px;color:' + (myTurn ? '#00ff88' : '#555') + ';">' + (myTurn ? 'YOUR TURN' : 'THEIR TURN') + '</div>'
    + '<div style="font-size:8px;color:#666;">' + remStr + ' left</div>'
    + '</div>'
    + '</div>'
    + (myTurn ? '<button onclick="onlineSend(\'corr:game_load\',{gameId:\'' + g.gameId + '\'})" style="width:100%;margin-top:6px;padding:4px;background:#001a0a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:8px;cursor:pointer;letter-spacing:1px;">OPEN GAME</button>' : '')
    + '</div>';
}

/* ── openCorrGame: restore board and enter correspondence mode ── */
function openCorrGame(game) {
  ONLINE.corrGame = game;
  // Close all overlays
  _onlineLobby.style.display = 'none';
  document.getElementById('mainMenu').style.display = 'none';
  var _pso = document.getElementById('playStepOnline'); if (_pso) _pso.style.display = 'none';
  // Set up game state
  playerColor = game.myColor;
  botColor     = null;
  ONLINE.inMatch = false; // not a real-time match
  ONLINE.gameMode = game.gameMode || 'standard';
  arcadeSettings.enabled = (ONLINE.gameMode === 'arcade');
  ctfMode = (ONLINE.gameMode === 'ctf' || ONLINE.gameMode === 'flag');
  timeEnabled = false; // correspondence uses server-side clock only
  // Restore board
  resetBoard(true);
  if (game.snapshot) {
    try {
      var state = JSON.parse(game.snapshot);
      pieces.forEach(function(p) { if (p.parent) p.parent.remove(p); }); pieces.length = 0;
      for (var k in boardMap) delete boardMap[k];
      state.forEach(function(s) { var p = buildPiece(s.type, s.color); place(p, s.x, s.y, s.z); p.userData.moved = s.moved; });
    } catch(e) { console.warn('[corr] snapshot restore failed:', e); }
  }
  // Set turn from game data
  turn = game.turn || 'white';
  document.getElementById('hud').textContent = turn.charAt(0).toUpperCase() + turn.slice(1) + ' to move';
  update(); coords(); setPOV();
  // Enable/disable input
  setGameInputEnabled(game.isMyTurn);
  // Show corr game HUD
  _onlineCorrShowHUD(game);
  var rb = document.getElementById('rotateBoardBtn'); if (rb) rb.style.display = 'block';
  var lv = document.getElementById('layerVisToggle');  if (lv) lv.style.display = 'block';
  var pb = document.getElementById('panBoardBtn');     if (pb) pb.style.display = 'block';
  var gb = document.getElementById('hudGearBtn');      if (gb) gb.style.display = 'block';
  document.getElementById('modeMenu').style.display  = 'none';
  document.getElementById('botMenu').style.display   = 'none';
  document.getElementById('puzzleBar').style.display = 'none';
  onlineLog('Opened corr game ' + game.gameId + ' as ' + game.myColor + (game.isMyTurn ? ' — your turn' : ' — waiting'));
}

/* ── Correspondence HUD indicator ── */
var _corrHUDEl = null;
function _onlineCorrShowHUD(game) {
  if (_corrHUDEl) _corrHUDEl.remove();
  var opp = game.myColor === 'white' ? game.blackUser : game.whiteUser;
  var rem = game.isMyTurn
    ? (game.myColor === 'white' ? game.whiteClockRemaining : game.blackClockRemaining)
    : (game.myColor === 'white' ? game.blackClockRemaining : game.whiteClockRemaining);
  var days = Math.max(0, Math.floor(rem / 86400000));
  var hrs  = Math.max(0, Math.floor((rem % 86400000) / 3600000));
  var remStr = days > 0 ? days + 'd ' + hrs + 'h' : hrs + 'h';
  var el = document.createElement('div');
  el.id = 'corrHUD';
  el.style.cssText = 'position:fixed;top:calc(8px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:22;'
    + 'background:rgba(0,0,0,0.82);border:1px solid #333;border-radius:2px;'
    + 'font-family:monospace;font-size:9px;letter-spacing:1px;padding:4px 12px;'
    + 'pointer-events:auto;white-space:nowrap;display:flex;align-items:center;gap:10px;';
  var turnCol = game.isMyTurn ? '#00ff88' : '#555';
  el.innerHTML = '<span style="color:#444">CORRESPONDENCE</span>'
    + '<span style="color:' + turnCol + '">' + (game.isMyTurn ? 'YOUR TURN' : _esc(opp) + '\'s turn') + '</span>'
    + '<span style="color:#333">|</span>'
    + '<span style="color:#666">' + remStr + ' left</span>'
    + '<span style="color:#333">|</span>'
    + '<button id="_corrBackBtn" style="background:none;border:1px solid #222;color:#555;font-family:monospace;font-size:8px;padding:2px 8px;cursor:pointer;letter-spacing:1px;">GAMES</button>';
  document.body.appendChild(el);
  _corrHUDEl = el;
  el.querySelector('#_corrBackBtn').onclick = function() {
    if (_corrHUDEl) { _corrHUDEl.remove(); _corrHUDEl = null; }
    ONLINE.corrGame = null;
    document.getElementById('mainMenu').style.display = 'flex';
  };
}

/* ── Return-to-site banner: "It's your turn in X games" ── */
function onlineShowCorrTurnBanner(count) {
  var existing = document.getElementById('corrTurnBanner');
  if (existing) existing.remove();
  // Only show if a menu or lobby is visible (not during gameplay)
  var menuVis = document.getElementById('mainMenu').style.display !== 'none'
    || _onlineLobby.style.display !== 'none';
  if (!menuVis) return;
  var banner = document.createElement('div');
  banner.id = 'corrTurnBanner';
  banner.style.cssText = 'position:fixed;top:calc(48px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);'
    + 'background:#001a0a;border:1px solid #00ff88;font-family:monospace;font-size:10px;'
    + 'color:#00ff88;padding:7px 16px;z-index:55;letter-spacing:1px;display:flex;align-items:center;gap:10px;'
    + 'white-space:nowrap;border-radius:2px;';
  banner.innerHTML = 'It\'s your turn in <b>' + count + '</b> game' + (count > 1 ? 's' : '')
    + '<button id="_corrBannerView" style="background:#002a14;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:9px;padding:2px 10px;cursor:pointer;">VIEW GAMES</button>'
    + '<button id="_corrBannerClose" style="background:none;border:none;color:#005530;font-family:monospace;font-size:11px;cursor:pointer;padding:0 2px;">✕</button>';
  document.body.appendChild(banner);
  banner.querySelector('#_corrBannerView').onclick = function() {
    banner.remove();
    onlineOpenLobby();
    setTimeout(function() { _lobbyShowSection('onlineCorrGamesSection'); _ygTab('active'); onlineLobbyUpdateGamesPanel(); }, 100);
  };
  banner.querySelector('#_corrBannerClose').onclick = function() { banner.remove(); };
  setTimeout(function() { if (banner.parentNode) banner.remove(); }, 12000);
}

var _queued = false;
var _queueSeconds = 0, _queueTimerRef = null, _queueHoldUntil = 0, _queueCompatible = 0, _queuedEloRange = 150;

function onlineQueueTimer() {
  _queueSeconds = 0; clearInterval(_queueTimerRef);
  _queueTimerRef = setInterval(function() {
    if (!_queued) { clearInterval(_queueTimerRef); return; }
    _queueSeconds++;
    var m = Math.floor(_queueSeconds/60), s = _queueSeconds%60;
    var timeStr = m + ':' + (s < 10 ? '0' : '') + s;
    var timerEl = document.getElementById('onlineSearchTimer');
    if (timerEl) timerEl.textContent = timeStr;
    var pt = document.getElementById('psoLobbyTimer');
    if (pt) pt.textContent = timeStr;
    // Update range display
    var elapsed = _queueSeconds, expansions = Math.floor(elapsed / 30);
    var curRange = _queuedEloRange > 0 ? _queuedEloRange + expansions * 25 : 0;
    var nextIn   = 30 - (elapsed % 30);
    var pr = ONLINE.player && _queuedPool ? (ONLINE.poolRatings[_queuedPool] || {}) : {};
    var myRat = pr.rating || 1200;
    var rangeStr = curRange > 0 ? (myRat - curRange) + ' – ' + (myRat + curRange) : 'Any';
    if (curRange > 0) rangeStr += '  · widening in ' + nextIn + 's';
    var rangeEl = document.getElementById('onlineSearchRange');
    if (rangeEl) rangeEl.textContent = 'Searching: ' + rangeStr;
    var cntEl = document.getElementById('onlineSearchCount');
    if (cntEl) cntEl.textContent = _queueCompatible === 0 ? 'no one matching yet'
      : _queueCompatible === 1 ? '1 potential match'
      : _queueCompatible + ' potential matches';
  }, 1000);
}

// Restore queue timer display on lobby re-open if still searching
function _lobbyRestoreSearchState() {
  if (_queued) {
    _lobbyShowSection('onlineSearchingSection');
    var tc2 = _queuedTc || 'none';
    var pool2 = _queuedPool || '';
    document.getElementById('onlineSearchTC').textContent = tc2.replace('+','|');
    var parts2 = pool2.split('_');
    document.getElementById('onlineSearchPool').textContent = (parts2[0]||'').toUpperCase() + ' · ' + (parts2[1]||'').toUpperCase();
  }
}

function onlineOpenLobby() {
  _onlineLobby.style.display = 'flex';
  onlineUpdateUI();
  // Auto-connect using default/stored server
  if (!ONLINE.connected) {
    var url = localStorage.getItem('cc_server_url') || ONLINE_SERVER;
    if (url) onlineConnect(url);
  }
}

function onlineUpdateUI() {
  var connected = ONLINE.connected, loggedIn = ONLINE.loggedIn, player = ONLINE.player;
  var sl = document.getElementById('onlineLobbyStatus');
  if (sl) {
    if      (!connected) sl.textContent = 'CONNECTING-';
    else if (!loggedIn)  sl.textContent = 'CONNECTED - login or register';
    else                 sl.textContent = 'ONLINE - ' + player.username;
  }
  document.getElementById('onlineAuthSection').style.display   = (connected && !loggedIn) ? 'block' : 'none';
  document.getElementById('onlinePlayerSection').style.display = (connected && loggedIn)  ? 'block' : 'none';
  document.getElementById('onlinePlaySection').style.display   = (connected && loggedIn)  ? 'block' : 'none';
  if (player) {
    document.getElementById('onlinePlayerName').textContent = (player.avatar||'-') + ' ' + player.username;
    document.getElementById('onlinePlayerElo').textContent  = 'ELO ' + (player.elo||1200) + (player.ratedGames ? '  ('+player.ratedGames+' rated)' : '  (unrated)');
    document.getElementById('onlinePlayerStats').textContent =
      'W ' + (player.wins||0) + '  /  D ' + (player.draws||0) + '  /  L ' + (player.losses||0);
  }
}

function onlineShowAuthError(msg) { document.getElementById('onlineAuthError').textContent = msg; }
function onlineCloseAuthOverlay() {
  document.getElementById('onlineAuthError').textContent = '';
  var gns = document.getElementById('onlineGoogleUsernameSection');
  if (gns) gns.style.display = 'none';
}

function _onlineAuthTab(tab) {
  var isLogin = tab === 'login';
  document.getElementById('authTabLogin').style.background    = isLogin ? '#001833' : '#1a1a1a';
  document.getElementById('authTabLogin').style.color         = isLogin ? '#00ccff' : '#555';
  document.getElementById('authTabRegister').style.background = isLogin ? '#1a1a1a' : '#001833';
  document.getElementById('authTabRegister').style.color      = isLogin ? '#555'    : '#00ccff';
  document.getElementById('onlineLoginBtn').style.display    = isLogin ? 'block' : 'none';
  document.getElementById('onlineRegisterBtn').style.display = isLogin ? 'none'  : 'block';
  document.getElementById('onlineAvatarRow').style.display   = isLogin ? 'none'  : 'block';
  document.getElementById('onlinePasswordInput').placeholder = isLogin ? 'Password' : 'Choose a password';
  onlineShowAuthError('');
}

var _onlineGooglePendingId = null;
var _onlineGooglePendingEmail = null;

function _onlineGoogleSignin() {
  var clientId = (typeof GOOGLE_CLIENT_ID !== 'undefined') ? GOOGLE_CLIENT_ID : '';
  if (!clientId) {
    onlineShowAuthError('Google sign-in not configured');
    return;
  }
  if (window.location.protocol === 'file:') {
    onlineShowAuthError('Google sign-in requires HTTP server');
    return;
  }
  if (window._onlineGisLoading) return;
  window._onlineGisLoading = true;
  var btn = document.getElementById('onlineGoogleSigninBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  var s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.onload = function() {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: _onlineGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    google.accounts.id.prompt();
    if (btn) { btn.disabled = false; btn.textContent = 'G  Sign in with Google'; }
  };
  s.onerror = function() {
    onlineShowAuthError('Failed to load Google sign-in');
    window._onlineGisLoading = false;
    if (btn) { btn.disabled = false; btn.textContent = 'G  Sign in with Google'; }
  };
  document.head.appendChild(s);
}

function _onlineGoogleCredential(response) {
  var profile = (typeof _decodeGoogleJwt === 'function') ? _decodeGoogleJwt(response.credential) : null;
  if (!profile || !profile.sub) { onlineShowAuthError('Google sign-in failed'); return; }
  onlineSend('google_login', { googleId: profile.sub, email: profile.email, token: response.credential });
}

function onlineLoadLeaderboard() {
  document.getElementById('onlinePlaySection').style.display = 'none';
  document.getElementById('onlineLbSection').style.display   = 'block';
  document.getElementById('onlineLbContent').textContent     = 'Loading-';
  var url = (localStorage.getItem('cc_server_url')||'').replace('ws://','http://').replace('wss://','https://');
  fetch(url + '/leaderboard').then(function(r) { return r.json(); }).then(function(lb) {
    if (!lb.length) { document.getElementById('onlineLbContent').textContent = 'No rated games yet.'; return; }
    document.getElementById('onlineLbContent').innerHTML = lb.map(function(p,i) {
      return '<div style="display:flex;justify-content:space-between;">'
        + '<span style="color:#666;cursor:pointer;" onclick="onlineOpenProfile(\'' + p.username.replace(/'/g,"\\'") + '\')">' + (i+1) + '. ' + p.avatar + ' ' + p.username + '</span>'
        + '<span style="color:#00ccff;">' + p.elo + '</span></div>';
    }).join('');
  }).catch(function() { document.getElementById('onlineLbContent').textContent = 'Could not load.'; });
}

function onlineLoadHistory() {
  // Redirect to the unified Your Games section, history tab
  _lobbyShowSection('onlineCorrGamesSection');
  _ygTab('history');
  onlineLobbyUpdateGamesPanel();
}

function onlineShowMatchBanner(matchInfo) {
  _onlineLobby.style.display = 'none';
  document.getElementById('mainMenu').style.display = 'none';
  var _pso = document.getElementById('playStepOnline'); if (_pso) _pso.style.display = 'none';
  var _fp  = document.getElementById('friendPanel');    if (_fp)  _fp.style.display  = 'none';
  _queued = false; clearInterval(_queueTimerRef);
  // Return searching section to play section (new lobby has no legacy queueBtn)
  _lobbyShowSection('onlinePlaySection');
  var qb = document.getElementById('onlineQueueBtn');
  if (qb) { qb.textContent = 'FIND MATCH'; qb.style.borderColor = '#00ff88'; qb.style.color = '#00ff88'; }
  var qs = document.getElementById('onlineQueueStatus'); if (qs) qs.textContent = '';
  // Unlock match settings
  var ms = document.getElementById('onlineMatchSettings');
  if (ms) { ms.style.opacity = ''; ms.style.pointerEvents = ''; }
  var banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:rgba(0,0,0,0.95);border:1px solid #00ccff;font-family:monospace;'
    + 'color:#fff;padding:28px 36px;z-index:50;text-align:center;letter-spacing:2px;';
  var modeLabel = (matchInfo.gameMode || 'standard').toUpperCase();
  var tcLabel   = (matchInfo.timeControl && matchInfo.timeControl !== 'none') ? matchInfo.timeControl.toUpperCase() : '';
  var rankLabel = matchInfo.rated !== false ? '<span style="color:#00ccff">RANKED</span>' : '<span style="color:#555">UNRANKED</span>';
  banner.innerHTML = '<div style="font-size:14px;color:#00ccff;margin-bottom:10px;">MATCH FOUND</div>'
    + '<div style="font-size:9px;color:#555;letter-spacing:2px;margin-bottom:8px;">'
    +   modeLabel + (tcLabel ? ' · ' + tcLabel : '') + ' · ' + rankLabel + '</div>'
    + '<div style="font-size:11px;color:#888;margin-bottom:6px;">You are <span style="color:#fff">'
    + matchInfo.color.toUpperCase() + '</span></div>'
    + '<div style="font-size:13px;">vs ' + (matchInfo.opponent.avatar||'-') + ' ' + matchInfo.opponent.username + '</div>'
    + '<div style="font-size:10px;color:#00ccff;margin-top:4px;">ELO ' + matchInfo.opponent.elo + '</div>'
    + '<div style="font-size:9px;color:#555;margin-top:14px;">connecting-</div>';
  document.body.appendChild(banner);
  setTimeout(function() { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 3000);
}

function onlineShowEloToast(delta, newElo, result) {
  var col = result==='win' ? '#00ff88' : result==='loss' ? '#ff4444' : '#ffaa00';
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:calc(60px + env(safe-area-inset-top));right:16px;background:rgba(0,0,0,0.92);'
    + 'border:1px solid '+col+';font-family:monospace;font-size:11px;color:'+col+';'
    + 'padding:10px 16px;z-index:55;letter-spacing:1px;transition:opacity 0.5s;';
  toast.innerHTML = result.toUpperCase() + '<br>ELO ' + (delta>=0?'+':'') + delta + ' - ' + newElo;
  document.body.appendChild(toast);
  setTimeout(function() { toast.style.opacity = '0'; }, 3000);
  setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3600);
}

function onlineShowToast(msg, colorInt) {
  var col = '#' + (colorInt||0xaaaaaa).toString(16).padStart(6,'0');
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:calc(60px + env(safe-area-inset-top));right:16px;background:rgba(0,0,0,0.92);'
    + 'border:1px solid '+col+';font-family:monospace;font-size:10px;color:'+col+';'
    + 'padding:10px 16px;z-index:55;letter-spacing:1px;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
}

function onlineDoRematch() {
  ONLINE.myColor = ONLINE.myColor === 'white' ? 'black' : 'white';
  ONLINE.inMatch = true; ONLINE._drawOfferSent = false;
  playerColor = ONLINE.myColor; botColor = null;
  arcadeSettings.enabled = (ONLINE.gameMode === 'arcade');
  ctfMode = (ONLINE.gameMode === 'ctf');
  var _tcMapR = { bullet:1, blitz:5, rapid:10, classical:30 };
  if (ONLINE.timeControl && _tcMapR[ONLINE.timeControl]) {
    TIME_CONTROL_MINS = _tcMapR[ONLINE.timeControl]; timeEnabled = true;
  } else { timeEnabled = false; }
  document.getElementById('endMenu').style.display = 'none';
  var rb=document.getElementById('rematchBtn'); if(rb){rb.textContent='↺ Rematch';rb.disabled=false;}
  startLocalGame();
  onlineShowColorIndicator(ONLINE.myColor, ONLINE.opponent);
  onlineUpdateThinking();
}

function onlineShowRematchOffer() {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:rgba(0,0,0,0.95);border:1px solid #00aaff;font-family:monospace;color:#fff;'
    + 'padding:24px 32px;z-index:55;text-align:center;letter-spacing:2px;';
  el.innerHTML = '<div style="color:#00aaff;margin-bottom:14px;">REMATCH OFFERED</div>'
    + '<div style="display:flex;gap:10px;justify-content:center;">'
    + '<button id="rematchAccept" style="background:#1a1a1a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:11px;padding:7px 18px;cursor:pointer;">ACCEPT</button>'
    + '<button id="rematchDecline" style="background:#1a1a1a;border:1px solid #555;color:#555;font-family:monospace;font-size:11px;padding:7px 18px;cursor:pointer;">DECLINE</button>'
    + '</div><div id="_rematchCountdown" style="font-size:8px;color:#333;margin-top:10px;">Expires in 30s</div>';
  document.body.appendChild(el);
  var _remCd = 30, _remCdInt = setInterval(function() {
    _remCd--; var cEl = document.getElementById('_rematchCountdown');
    if (cEl) cEl.textContent = 'Expires in ' + _remCd + 's';
    if (_remCd <= 0) clearInterval(_remCdInt);
  }, 1000);
  function _cleanRematch() { clearInterval(_remCdInt); el.remove(); }
  el.querySelector('#rematchAccept').onclick = function() { onlineDCSend('rematch_accept'); onlineDoRematch(); _cleanRematch(); };
  el.querySelector('#rematchDecline').onclick = function() { onlineDCSend('rematch_decline'); _cleanRematch(); };
  setTimeout(function() { if (el.parentNode) { onlineDCSend('rematch_decline'); _cleanRematch(); } }, 30000);
}

function onlineShowDrawOffer() {
  if (ONLINE._drawOfferSent) { onlineDCSend('draw_accept'); onlineRecordResult('draw'); return; }
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:rgba(0,0,0,0.95);border:1px solid #ffaa00;font-family:monospace;color:#fff;'
    + 'padding:24px 32px;z-index:55;text-align:center;letter-spacing:2px;';
  el.innerHTML = '<div style="color:#ffaa00;margin-bottom:14px;">DRAW OFFERED</div>'
    + '<div style="display:flex;gap:10px;justify-content:center;">'
    + '<button id="drawAccept" style="background:#1a1a1a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:11px;padding:7px 18px;cursor:pointer;">ACCEPT</button>'
    + '<button id="drawDecline" style="background:#1a1a1a;border:1px solid #555;color:#555;font-family:monospace;font-size:11px;padding:7px 18px;cursor:pointer;">DECLINE</button>'
    + '</div><div id="_drawCountdown" style="font-size:8px;color:#333;margin-top:10px;">Expires in 25s</div>';
  document.body.appendChild(el);
  var _drawCd = 25, _drawCdInt = setInterval(function() {
    _drawCd--; var cEl = document.getElementById('_drawCountdown');
    if (cEl) cEl.textContent = 'Expires in ' + _drawCd + 's';
    if (_drawCd <= 0) clearInterval(_drawCdInt);
  }, 1000);
  function _cleanDraw() { clearInterval(_drawCdInt); el.remove(); }
  el.querySelector('#drawAccept').onclick = function() { onlineDCSend('draw_accept'); onlineRecordResult('draw'); _cleanDraw(); };
  el.querySelector('#drawDecline').onclick = function() { onlineDCSend('draw_decline'); _cleanDraw(); };
  setTimeout(function() { if (el.parentNode) { onlineDCSend('draw_decline'); _cleanDraw(); } }, 25000);
}

/* -- Profile overlay ------------------------------------------- */
var _onlineProfileOverlay = (function() {
  var el = document.createElement('div');
  el.id = 'onlineProfileOverlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);display:none;'
    + 'justify-content:center;align-items:center;z-index:46;font-family:monospace;color:#fff;';
  el.innerHTML = '<div style="width:320px;max-height:88vh;overflow-y:auto;background:#0a0a0a;border:1px solid #222;padding:24px;box-sizing:border-box;">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">'
    +   '<div>'
    +     '<div id="profileAvatar" style="font-size:26px;margin-bottom:4px;"></div>'
    +     '<div id="profileName" style="font-size:14px;letter-spacing:2px;"></div>'
    +     '<div id="profileElo" style="font-size:10px;color:#00ccff;letter-spacing:2px;margin-top:3px;"></div>'
    +   '</div>'
    +   '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">'
    +     '<button id="profileClose" style="background:none;border:1px solid #222;color:#555;font-family:monospace;font-size:10px;padding:4px 10px;cursor:pointer;">CLOSE</button>'
    +     '<button id="profileEditAvatar" style="display:none;background:none;border:1px solid #1a1a1a;color:#333;font-family:monospace;font-size:9px;padding:3px 8px;cursor:pointer;">EDIT AVATAR</button>'
    +   '</div>'
    + '</div>'
    + '<div id="profileStats" style="display:flex;gap:16px;font-size:10px;letter-spacing:1px;margin-bottom:16px;"></div>'
    + '<canvas id="profileEloGraph" width="272" height="56" style="display:none;width:100%;margin-bottom:16px;border:1px solid #0f0f0f;"></canvas>'
    + '<div id="profileAvatarPicker" style="display:none;margin-bottom:16px;"></div>'
    + '<div id="profileRatingsSection" style="display:none;margin-bottom:16px;">'
    +   '<div style="font-size:8px;color:#444;letter-spacing:2px;margin-bottom:8px;">RATINGS BY FORMAT</div>'
    +   '<div style="display:flex;gap:2px;margin-bottom:8px;">'
    +     '<button data-ratmode="standard" onclick="onlineProfileRatingsSetMode(\'standard\')" style="flex:1;padding:4px;background:#001a2a;border:1px solid #00ccff;color:#00ccff;font-family:monospace;font-size:7px;cursor:pointer;letter-spacing:1px;">STANDARD</button>'
    +     '<button data-ratmode="arcade"   onclick="onlineProfileRatingsSetMode(\'arcade\')"   style="flex:1;padding:4px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:7px;cursor:pointer;letter-spacing:1px;">ARCADE</button>'
    +     '<button data-ratmode="flag"     onclick="onlineProfileRatingsSetMode(\'flag\')"     style="flex:1;padding:4px;background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:7px;cursor:pointer;letter-spacing:1px;">FLAG</button>'
    +   '</div>'
    +   '<div id="profileRatingsGrid"></div>'
    + '</div>'
    + '<div id="profileHistory"></div>'
    + '</div>';
  document.body.appendChild(el);
  return el;
})();
document.getElementById('profileClose').onclick = function() { _onlineProfileOverlay.style.display = 'none'; };
document.getElementById('profileEditAvatar').onclick = function() {
  var p = document.getElementById('profileAvatarPicker');
  if (p.style.display === 'none') onlineShowAvatarPicker(); else p.style.display = 'none';
};

function onlineOpenProfile(username) {
  _onlineProfileOverlay.style.display = 'flex';
  var isOwn = ONLINE.player && ONLINE.player.username === username;
  document.getElementById('profileAvatar').textContent  = '?';
  document.getElementById('profileName').textContent    = username;
  document.getElementById('profileElo').textContent     = 'Loading...';
  document.getElementById('profileStats').innerHTML     = '';
  document.getElementById('profileHistory').innerHTML   = '<div style="color:#333;font-size:9px;">Loading...</div>';
  document.getElementById('profileEloGraph').style.display    = 'none';
  document.getElementById('profileAvatarPicker').style.display = 'none';
  document.getElementById('profileEditAvatar').style.display   = isOwn ? 'block' : 'none';
  // Reset ratings section
  _profileRatingsData = {};
  _profileRatingsMode = 'standard';
  var ratSec = document.getElementById('profileRatingsSection');
  if (ratSec) ratSec.style.display = 'none';
  var base = (localStorage.getItem('cc_server_url')||'').replace('ws://','http://').replace('wss://','https://');
  fetch(base + '/player/' + encodeURIComponent(username))
    .then(function(r) { return r.json(); })
    .then(function(p) {
      document.getElementById('profileAvatar').textContent = p.avatar || '♟';
      document.getElementById('profileName').textContent   = p.username;
      document.getElementById('profileElo').textContent    = 'ELO ' + (p.elo||1200) + (p.ratedGames ? '  ·  ' + p.ratedGames + ' rated' : '  ·  unrated');
      document.getElementById('profileStats').innerHTML    =
        '<span style="color:#00ff88;">W ' + (p.wins||0) + '</span>'
        + '<span style="color:#444;">  /  </span><span style="color:#aaa;">D ' + (p.draws||0) + '</span>'
        + '<span style="color:#444;">  /  </span><span style="color:#ff4444;">L ' + (p.losses||0) + '</span>';
    }).catch(function() { document.getElementById('profileElo').textContent = 'Could not load'; });
  fetch(base + '/player/' + encodeURIComponent(username) + '/history')
    .then(function(r) { return r.json(); })
    .then(function(hist) {
      if (!hist.length) { document.getElementById('profileHistory').innerHTML = '<div style="color:#333;font-size:9px;">No games yet</div>'; return; }
      var eloPoints = hist.filter(function(g) { return g.rated && g.eloAfter; }).map(function(g) { return g.eloAfter; });
      if (eloPoints.length >= 2) { var cv = document.getElementById('profileEloGraph'); cv.style.display = 'block'; onlineDrawEloGraph(cv, eloPoints); }
      document.getElementById('profileHistory').innerHTML =
        '<div style="color:#444;letter-spacing:1px;font-size:9px;margin-bottom:8px;">RECENT GAMES</div>'
        + hist.map(function(g) {
            var col  = g.result==='win' ? '#00ff88' : g.result==='loss' ? '#ff4444' : '#ffaa00';
            var elo  = (g.rated && g.delta != null) ? ((g.delta>=0?'+':'')+g.delta) : '';
            var date = g.played_at ? new Date(g.played_at).toLocaleDateString() : '';
            var mode = (g.game_mode && g.game_mode!=='standard') ? ' · '+g.game_mode : '';
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #0f0f0f;">'
              + '<div><span style="color:'+col+';font-size:9px;">'+g.result.toUpperCase()+'</span>'
              + '<span style="color:#333;margin:0 5px;">·</span>'
              + '<span style="color:#aaa;font-size:9px;cursor:pointer;" onclick="onlineOpenProfile(\''+( g.opponent||'').replace(/'/g,"\\'")+'\')">'+(g.opponent_avatar||'♟')+' '+(g.opponent||'?')+'</span>'
              + (mode?'<span style="color:#333;font-size:8px;">'+mode+'</span>':'')+'</div>'
              + '<div style="text-align:right;font-size:9px;">'+(elo?'<span style="color:'+col+';">'+elo+'</span>  ':'')+' <span style="color:#333;">'+date+'</span></div></div>';
          }).join('');
    }).catch(function() { document.getElementById('profileHistory').innerHTML = '<div style="color:#333;font-size:9px;">No history available</div>'; });
  // Fetch per-pool ratings
  fetch(base + '/player/' + encodeURIComponent(username) + '/ratings')
    .then(function(r) { return r.json(); })
    .then(function(arr) {
      if (!arr || !arr.length) return;
      _profileRatingsData = {};
      arr.forEach(function(r) { if (r.pool) _profileRatingsData[r.pool] = r; });
      var ratSec2 = document.getElementById('profileRatingsSection');
      if (ratSec2) { ratSec2.style.display = 'block'; }
      onlineProfileRatingsSetMode('standard');
    }).catch(function() {});
}

function onlineDrawEloGraph(canvas, points) {
  canvas.width = canvas.offsetWidth || canvas.width;
  canvas.height = 80;
  var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  var min = Math.min.apply(null,points), max = Math.max.apply(null,points), range = max-min||1;
  ctx.strokeStyle = '#00ccff'; ctx.lineWidth = 1.5; ctx.beginPath();
  points.forEach(function(v,i) {
    var x = (i/(points.length-1))*(w-6)+3, y = h-6-((v-min)/range)*(h-12);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
  var lx=w-3, lv=points[points.length-1], ly=h-6-((lv-min)/range)*(h-12);
  ctx.fillStyle='#00ccff'; ctx.beginPath(); ctx.arc(lx,ly,2.5,0,Math.PI*2); ctx.fill();
  ctx.font='8px monospace'; ctx.fillText(String(lv), lx-(String(lv).length*5)-4, ly<14?ly+10:ly-4);
}

function onlineShowAvatarPicker() {
  var picker = document.getElementById('profileAvatarPicker');
  var groups = [
    { label: 'CHESS',   items: ['♟','♞','♝','♜','♛','♚','♙','♘','♗','♖','♕','♔'] },
    { label: 'NATURE',  items: ['🌙','⭐','🌟','☀️','❄️','🌊','🌪️','🌈','🍄','🌸','🌿','🦋'] },
    { label: 'FIRE',    items: ['🔥','⚡','💥','✨','💫','🌀','🎆','🎇','☄️','🌌','🔮','💎'] },
    { label: 'ANIMALS', items: ['🦁','🐺','🦊','🐻','🦅','🦉','🐉','🦄','🐯','🦂','🦈','🦇'] },
    { label: 'ICONS',   items: ['👑','🎯','🎲','⚔️','🛡️','🏆','🎪','🎭','🎨','🃏','🎱','🔱'] },
    { label: 'SCI-FI',  items: ['🤖','👾','🛸','🚀','💀','👻','🕶️','🌐','⚙️','🔬','🧬','🧪'] }
  ];
  picker.style.display = 'block';
  picker.innerHTML = '<div style="font-size:9px;color:#444;letter-spacing:1px;margin-bottom:8px;">CHOOSE AVATAR</div>'
    + groups.map(function(g) {
        return '<div style="margin-bottom:8px;">'
          + '<div style="font-size:7px;color:#333;letter-spacing:1px;margin-bottom:4px;">'+g.label+'</div>'
          + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
          + g.items.map(function(a) {
              return '<button onclick="onlineSetAvatar(\''+a+'\')" style="background:#1a1a1a;border:1px solid #222;font-size:15px;padding:3px 5px;cursor:pointer;line-height:1;">'+a+'</button>';
            }).join('')
          + '</div></div>';
      }).join('');
}
function onlineSetAvatar(avatar) {
  onlineSend('update_avatar', { avatar: avatar });
  document.getElementById('profileAvatar').textContent = avatar;
  if (ONLINE.player) { ONLINE.player.avatar = avatar; }
  document.getElementById('profileAvatarPicker').style.display = 'none';
  onlineUpdateUI();
}

/* -- Per-pool ratings in profile --------------------------------- */
var _profileRatingsData = {};  // pool → {rating, games, wins, losses, draws}
var _profileRatingsMode = 'standard';

function onlineProfileRatingsSetMode(mode) {
  _profileRatingsMode = mode;
  document.querySelectorAll('[data-ratmode]').forEach(function(b) {
    var active = b.dataset.ratmode === mode;
    b.style.borderColor = active ? '#00ccff' : '#222';
    b.style.color       = active ? '#00ccff' : '#555';
    b.style.background  = active ? '#001a2a' : '#1a1a1a';
  });
  _renderProfileRatingsGrid();
}

function _renderProfileRatingsGrid() {
  var grid = document.getElementById('profileRatingsGrid');
  if (!grid) return;
  var cats = ['blitz', 'rapid', 'classical', 'correspondence'];
  var catLabels = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Corr.' };
  var catColors = { blitz: '#ffaa00', rapid: '#00ccff', classical: '#00e5ff', correspondence: '#00ff88' };
  grid.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:8px;">'
    + '<tr style="color:#333;letter-spacing:1px;border-bottom:1px solid #111;">'
    + '<td style="padding:3px 4px;">FORMAT</td><td style="padding:3px 4px;text-align:right;">RATING</td>'
    + '<td style="padding:3px 4px;text-align:right;">GAMES</td>'
    + '<td style="padding:3px 4px;text-align:right;color:#00ff88;">W</td>'
    + '<td style="padding:3px 4px;text-align:right;color:#ffaa00;">D</td>'
    + '<td style="padding:3px 4px;text-align:right;color:#ff4444;">L</td></tr>'
    + cats.map(function(cat) {
        var pool = _profileRatingsMode + '_' + cat;
        var r = _profileRatingsData[pool];
        var ratingStr = r ? (r.rating || 1200) + ((r.games||0) < 10 ? '<span style="color:#555">?</span>' : '') : '—';
        var games  = r ? (r.games || 0) : 0;
        var wins   = r ? (r.wins || 0) : 0;
        var draws  = r ? (r.draws || 0) : 0;
        var losses = r ? (r.losses || 0) : 0;
        var col = catColors[cat];
        return '<tr style="border-bottom:1px solid #0a0a0a;">'
          + '<td style="padding:5px 4px;color:' + col + ';">' + catLabels[cat] + '</td>'
          + '<td style="padding:5px 4px;text-align:right;color:' + (r ? '#fff' : '#333') + ';">' + ratingStr + '</td>'
          + '<td style="padding:5px 4px;text-align:right;color:#444;">' + (r ? games : '—') + '</td>'
          + '<td style="padding:5px 4px;text-align:right;color:#00ff88;">' + (r ? wins : '—') + '</td>'
          + '<td style="padding:5px 4px;text-align:right;color:#ffaa00;">' + (r ? draws : '—') + '</td>'
          + '<td style="padding:5px 4px;text-align:right;color:#ff4444;">' + (r ? losses : '—') + '</td>'
          + '</tr>';
      }).join('')
    + '</table>';
}

/* -- Friends UI ------------------------------------------------ */
function onlineUpdateFriends() {
  // Update main menu profile badge
  var badge = document.getElementById('mainProfileBadge');
  if (badge) {
    var nb = ONLINE.requests.length;
    badge.textContent = nb > 0 ? String(nb) : '';
    badge.style.display = nb > 0 ? 'inline-block' : 'none';
  }
  var btn = document.getElementById('onlineFriendsBtn');
  if (btn) {
    var n = ONLINE.requests.length;
    btn.textContent = 'FRIENDS' + (n ? ' ('+n+')' : '');
    btn.style.color = n ? '#ffaa00' : '#666';
    btn.style.borderColor = n ? '#ffaa00' : '#333';
  }
  var reqEl = document.getElementById('onlineFriendRequests');
  if (reqEl) {
    var reqHtml = '';
    if (ONLINE.requests.length) {
      reqHtml += '<div style="font-size:9px;color:#444;letter-spacing:1px;margin-bottom:6px;">REQUESTS</div>'
        + ONLINE.requests.map(function(r) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
              + '<span style="color:#aaa;font-size:9px;">'+_esc(r.avatar||'♟')+' '+_esc(r.from)+'</span>'
              + '<div style="display:flex;gap:4px;">'
              + '<button onclick="onlineSend(\'friend_accept\',{from:\''+_esc(r.from)+'\'})" style="background:#1a1a1a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">✓</button>'
              + '<button onclick="onlineSend(\'friend_decline\',{from:\''+_esc(r.from)+'\'})" style="background:#1a1a1a;border:1px solid #333;color:#555;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">✕</button>'
              + '</div></div>';
          }).join('');
    }
    if (ONLINE.pendingOut.length) {
      reqHtml += '<div style="font-size:9px;color:#444;letter-spacing:1px;margin-bottom:6px;margin-top:8px;">SENT</div>'
        + ONLINE.pendingOut.map(function(u) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
              + '<span style="color:#555;font-size:9px;">♟ '+_esc(u)+'</span>'
              + '<button onclick="onlineCancelFriendRequest(\''+_esc(u).replace(/'/g,"\\'")+'\''+')" style="background:#1a1a1a;border:1px solid #333;color:#555;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">CANCEL</button>'
              + '</div>';
          }).join('');
    }
    reqEl.innerHTML = reqHtml;
  }
  var listEl = document.getElementById('onlineFriendList');
  if (!listEl) return;
  if (!ONLINE.friends.length) { listEl.innerHTML = '<div style="color:#333;font-size:9px;">No friends yet</div>'; return; }
  var sorted = ONLINE.friends.slice().sort(function(a,b) { var o={idle:0,queued:1,playing:2,offline:3}; return (o[a.status]||3)-(o[b.status]||3); });
  listEl.innerHTML = sorted.map(function(f) {
    var col   = f.status==='offline'?'#333':f.status==='playing'?'#ffaa00':f.status==='queued'?'#ffff00':'#00ff88';
    var label = f.status==='playing'?'playing':f.status==='queued'?'searching':f.status==='offline'?'offline':'online';
    var canInvite = (f.status==='idle') && !ONLINE.inMatch;
    var safeU = _esc(f.username); var safeAv = _esc(f.avatar||'♟');
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #111;">'
      + '<div><span style="color:#aaa;font-size:9px;cursor:pointer;" onclick="onlineOpenProfile(\''+safeU.replace(/'/g,"\\'")+'\')">'+safeAv+' '+safeU+'</span>'
      + '<span style="color:'+col+';font-size:8px;margin-left:6px;">'+label+'</span></div>'
      + '<div style="display:flex;gap:4px;">'
      + (canInvite?'<button onclick="onlineSendInvite(\''+safeU.replace(/'/g,"\\'")+'\''+')" style="background:#1a1a1a;border:1px solid #00ccff;color:#00ccff;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">INVITE</button>':'')
      + '<button onclick="onlineRemoveFriend(\''+safeU.replace(/'/g,"\\'")+'\''+')" style="background:#1a1a1a;border:1px solid #1a1a1a;color:#333;font-family:monospace;font-size:8px;padding:3px 6px;cursor:pointer;" title="Remove">✕</button>'
      + '</div></div>';
  }).join('');
  // Refresh friend panel if open
  var fp = document.getElementById('friendPanel');
  if (fp && fp.style.display !== 'none') _renderFriendPanel(false);
}
function onlineRemoveFriend(username) {
  var ex = document.getElementById('_rmFriendModal'); if (ex) ex.remove();
  var el = document.createElement('div');
  el.id = '_rmFriendModal';
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:rgba(0,0,0,0.97);border:1px solid #333;font-family:monospace;color:#fff;'
    + 'padding:22px 28px;z-index:70;text-align:center;letter-spacing:1px;min-width:200px;';
  el.innerHTML = '<div style="font-size:10px;color:#aaa;margin-bottom:4px;">REMOVE FRIEND</div>'
    + '<div style="font-size:12px;margin-bottom:16px;">'+_esc(username)+'</div>'
    + '<div style="display:flex;gap:8px;justify-content:center;">'
    + '<button id="_rmYes" style="background:#1a1a1a;border:1px solid #ff4444;color:#ff4444;font-family:monospace;font-size:10px;padding:6px 16px;cursor:pointer;">REMOVE</button>'
    + '<button id="_rmNo" style="background:#1a1a1a;border:1px solid #333;color:#555;font-family:monospace;font-size:10px;padding:6px 14px;cursor:pointer;">CANCEL</button>'
    + '</div>';
  document.body.appendChild(el);
  el.querySelector('#_rmYes').onclick = function() { onlineSend('friend_remove', { username: username }); el.remove(); };
  el.querySelector('#_rmNo').onclick  = function() { el.remove(); };
}

function onlineCancelFriendRequest(username) {
  onlineSend('friend_cancel', { username: username });
  ONLINE.pendingOut = ONLINE.pendingOut.filter(function(u) { return u !== username; });
  onlineUpdateFriends();
}

/* -- Match invite criteria modal ------------------------------- */
function onlineSendInvite(username) {
  var ex = document.getElementById('onlineInviteModal'); if (ex) ex.remove();
  var el = document.createElement('div');
  el.id = 'onlineInviteModal';
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:rgba(0,0,0,0.97);border:1px solid #333;font-family:monospace;color:#fff;padding:24px 28px;z-index:60;min-width:240px;';
  el.innerHTML = '<div style="font-size:11px;color:#aaa;letter-spacing:2px;margin-bottom:14px;">INVITE  <span style="color:#fff;">'+_esc(username)+'</span></div>'
    + '<div style="margin-bottom:10px;"><div style="font-size:9px;color:#444;letter-spacing:1px;margin-bottom:4px;">TIME CONTROL</div>'
    + '<select id="_invTc" style="width:100%;background:#1a1a1a;border:1px solid #333;color:#aaa;font-family:monospace;font-size:10px;padding:5px;outline:none;">'
    + '<option value="none">No limit</option><option value="1">1 min (bullet)</option><option value="3">3 min (blitz)</option>'
    + '<option value="5">5 min (blitz)</option><option value="10">10 min (rapid)</option><option value="15">15 min (rapid)</option></select></div>'
    + '<div style="margin-bottom:10px;"><div style="font-size:9px;color:#444;letter-spacing:1px;margin-bottom:4px;">GAME MODE</div>'
    + '<select id="_invMode" style="width:100%;background:#1a1a1a;border:1px solid #333;color:#aaa;font-family:monospace;font-size:10px;padding:5px;outline:none;">'
    + '<option value="standard">Standard</option><option value="arcade">Arcade</option><option value="ctf">CTF</option></select></div>'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;"><div style="font-size:9px;color:#444;letter-spacing:1px;">RANKED</div>'
    + '<button id="_invRanked" data-on="false" style="background:#1a1a1a;border:1px solid #333;color:#555;font-family:monospace;font-size:9px;padding:3px 14px;cursor:pointer;">OFF</button></div>'
    + '<div style="display:flex;gap:8px;">'
    + '<button id="_invSend" style="flex:1;background:#1a1a1a;border:1px solid #00ccff;color:#00ccff;font-family:monospace;font-size:10px;padding:8px;cursor:pointer;letter-spacing:1px;">SEND INVITE</button>'
    + '<button id="_invCancel" style="background:#1a1a1a;border:1px solid #222;color:#555;font-family:monospace;font-size:10px;padding:8px 14px;cursor:pointer;">CANCEL</button></div>';
  document.body.appendChild(el);
  var rb = el.querySelector('#_invRanked');
  rb.onclick = function() { var on=rb.dataset.on==='true'; rb.dataset.on=String(!on); rb.textContent=!on?'ON':'OFF'; rb.style.color=!on?'#00ccff':'#555'; rb.style.borderColor=!on?'#00ccff':'#333'; };
  el.querySelector('#_invSend').onclick = function() {
    onlineSend('invite_match', { to: username, timeControl: el.querySelector('#_invTc').value, gameMode: el.querySelector('#_invMode').value, ranked: rb.dataset.on==='true' });
    el.remove();
  };
  el.querySelector('#_invCancel').onclick = function() { el.remove(); };
}

function onlineShowMatchInvite(payload) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:rgba(0,0,0,0.95);border:1px solid #00ccff;font-family:monospace;color:#fff;'
    + 'padding:24px 32px;z-index:9999;text-align:center;letter-spacing:2px;min-width:220px;';
  el.innerHTML = '<div style="color:#00ccff;margin-bottom:6px;font-size:12px;">MATCH INVITE</div>'
    + '<div style="font-size:11px;color:#aaa;margin-bottom:4px;">'+_esc(payload.avatar||'♟')+' '+_esc(payload.from)+'</div>'
    + '<div style="font-size:9px;color:#555;margin-bottom:14px;">ELO '+payload.elo+'</div>'
    + '<div style="display:flex;gap:10px;justify-content:center;">'
    + '<button id="_invAccept" style="background:#1a1a1a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:11px;padding:7px 18px;cursor:pointer;">ACCEPT</button>'
    + '<button id="_invDecline" style="background:#1a1a1a;border:1px solid #555;color:#555;font-family:monospace;font-size:11px;padding:7px 18px;cursor:pointer;">DECLINE</button>'
    + '</div><div id="_invCountdown" style="font-size:8px;color:#333;margin-top:10px;">Expires in 30s</div>';
  document.body.appendChild(el);
  var _invCd = 30, _invCdInt = setInterval(function() {
    _invCd--; var cEl = document.getElementById('_invCountdown');
    if (cEl) cEl.textContent = 'Expires in ' + _invCd + 's';
    if (_invCd <= 0) clearInterval(_invCdInt);
  }, 1000);
  function _cleanInv() { clearInterval(_invCdInt); el.remove(); }
  el.querySelector('#_invAccept').onclick = function() { onlineSend('invite_accept', { inviteId: payload.inviteId }); _cleanInv(); };
  el.querySelector('#_invDecline').onclick = function() { onlineSend('invite_decline', { inviteId: payload.inviteId }); _cleanInv(); };
  setTimeout(function() { if (el.parentNode) _cleanInv(); }, 30000);
}

function onlineLog(msg) { console.log('[online]', msg); }

/* ── Play-step online overlay ──────────────────────────────── */
var _psoInited = false;

function _psoCancelSeekIfAny() {
  if (ONLINE.mySeek) { onlineSend('corr:seek_cancel', {}); ONLINE.mySeek = null; }
}

function psoJoinTC(cat, tc) {
  if (!ONLINE.loggedIn) {
    // Show auth section inline — guest clicks Login/Register to continue
    var authReq = document.getElementById('psoAuthRequired');
    if (authReq) { authReq.style.display = 'block'; authReq.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    return;
  }
  var rated = document.getElementById('psoRatedChk') ? document.getElementById('psoRatedChk').checked : true;
  var isCorr = (cat === 'correspondence');
  document.getElementById('psoPlayOptions').style.display = 'none';
  document.getElementById('psoLobbyArea').style.display = 'block';

  if (isCorr) {
    var secsMap = { '1d':86400,'2d':172800,'3d':259200,'5d':432000,'7d':604800,'14d':1209600,'30d':2592000 };
    var secs = secsMap[tc] || (parseInt(tc) * 86400) || 86400;
    onlineSend('corr:seek_post', { timePerMove: secs, colorPref: 'random', gameMode: 'standard' });
    ONLINE.mySeek = { tc: tc };
    var corrLabels = { '1d':'1 DAY','2d':'2 DAYS','3d':'3 DAYS','5d':'5 DAYS','7d':'7 DAYS','14d':'14 DAYS','30d':'30 DAYS' };
    document.getElementById('psoLobbyText').textContent = 'SEEK POSTED — ' + (corrLabels[tc] || tc.toUpperCase());
    document.getElementById('psoLobbyTimer').textContent = 'Waiting for an opponent to accept...';
  } else {
    if (_queued) return;
    var eloRange = 150;
    _queued = true; _queuedPool = 'standard_' + cat; _queuedTc = tc;
    onlineSend('match:join', { timeControl: tc, gameMode: 'standard', ranked: rated, eloRange: eloRange });
    var tcLabel = tc.replace('+', '|');
    document.getElementById('psoLobbyText').textContent = 'SEARCHING — ' + tcLabel.toUpperCase();
    document.getElementById('psoLobbyTimer').textContent = '';
    onlineQueueTimer();
  }
}

function _openOnlinePlayStep() {
  var overlay = document.getElementById('playStepOnline');
  if (!overlay) return;
  _psoRefreshState();
  overlay.style.display = 'flex';
  if (_psoInited) return;
  _psoInited = true;

  document.getElementById('psoBack').onclick = function() {
    SND.ui(); _psoLeaveIfQueued(); _psoCancelSeekIfAny();
    overlay.style.display = 'none';
    document.getElementById('playStep2').style.display = 'flex';
  };
  document.getElementById('psoRetryBtn').onclick = function() {
    SND.ui();
    var url = localStorage.getItem('cc_server_url') || CC_DEFAULT_SERVER;
    if (url) onlineConnect(url);
    else { overlay.style.display = 'none'; onlineOpenLobby(); }
  };
  document.getElementById('psoLoginBtn').onclick = function() {
    SND.ui(); overlay.style.display = 'none'; onlineOpenLobby();
  };

  // Rated toggle label
  document.getElementById('psoRatedChk').onchange = function() {
    var lbl = document.getElementById('psoRatedLabel');
    if (lbl) { lbl.textContent = this.checked ? 'RATED' : 'UNRATED'; lbl.style.color = this.checked ? '#00ccff' : '#444'; }
  };

  // More time controls expander
  document.getElementById('psoMoreTCBtn').onclick = function() {
    var m = document.getElementById('psoMoreTC'), open = m.style.display !== 'none';
    m.style.display = open ? 'none' : 'flex';
    this.textContent = open ? 'More time controls ▾' : 'Less ▴';
  };

  // Time control buttons
  overlay.querySelectorAll('.psoTCBtn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      SND.confirm();
      psoJoinTC(btn.dataset.cat, btn.dataset.tc);
    });
  });

  document.getElementById('psoFriendGame').onclick = function() {
    SND.confirm(); overlay.style.display = 'none'; openFriendPanel(false, true);
  };
  document.getElementById('psoPrivateGame').onclick = function() {
    SND.confirm();
    var rated = document.getElementById('psoRatedChk').checked;
    onlineSend('room_create', { timeControl: 'none', gameMode: 'standard', ranked: rated });
  };
  document.getElementById('psoCancelBtn').onclick = function() {
    SND.ui(); _psoLeaveIfQueued(); _psoCancelSeekIfAny();
    document.getElementById('psoLobbyArea').style.display = 'none';
    document.getElementById('psoPlayOptions').style.display = 'block';
  };
  document.getElementById('psoCancelRoom').onclick = function() {
    SND.ui(); onlineSend('room_cancel', {});
    document.getElementById('psoPrivateSection').style.display = 'none';
  };
  document.getElementById('psoCopyCode').onclick = function() {
    var code = document.getElementById('psoRoomCode').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(code);
    this.textContent = 'COPIED'; var self = this;
    setTimeout(function() { self.textContent = 'COPY'; }, 1500);
  };
  document.getElementById('psoJoinBtn').onclick = function() {
    SND.confirm();
    var code = document.getElementById('psoJoinInput').value.trim().toUpperCase();
    if (!code) return;
    onlineSend('room_join', { code: code });
    document.getElementById('psoJoinInput').value = '';
  };
  document.getElementById('psoJoinInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('psoJoinBtn').click();
  });
}

function _psoRefreshState() {
  var connected = ONLINE.connected, loggedIn = ONLINE.loggedIn;
  var statusEl = document.getElementById('psoStatus');
  if (statusEl) statusEl.textContent =
    !connected ? 'OFFLINE' : !loggedIn ? 'CONNECTED — LOGIN REQUIRED' :
    'ONLINE — ' + (ONLINE.player ? ONLINE.player.username : '');
  var offNote = document.getElementById('psoOfflineNote');
  var authReq = document.getElementById('psoAuthRequired');
  var playOpt = document.getElementById('psoPlayOptions');
  var lobby   = document.getElementById('psoLobbyArea');
  var privSec = document.getElementById('psoPrivateSection');
  if (offNote) offNote.style.display = !connected ? 'block' : 'none';
  if (authReq) authReq.style.display = (connected && !loggedIn) ? 'block' : 'none';
  if (playOpt) playOpt.style.display = (connected && loggedIn) ? 'block' : 'none';
  if (lobby)   lobby.style.display   = 'none';
  if (privSec) privSec.style.display = 'none';
}

function _psoLeaveIfQueued() {
  if (_queued) {
    _queued = false; clearInterval(_queueTimerRef);
    onlineSend('queue_leave', {});
    var qb = document.getElementById('onlineQueueBtn');
    if (qb) { qb.textContent = 'FIND MATCH'; qb.style.borderColor = '#00ff88'; qb.style.color = '#00ff88'; }
    var qs = document.getElementById('onlineQueueStatus'); if (qs) qs.textContent = '';
  }
}

/* ── Full-screen friend panel ──────────────────────────────── */
function openFriendPanel(openAdd, challengeMode) {
  var panel = document.getElementById('friendPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  var addSection = document.getElementById('friendPanelAddSection');
  if (addSection) addSection.style.display = openAdd ? 'block' : 'none';
  var offline = document.getElementById('friendPanelOffline');
  if (offline) offline.style.display = ONLINE.connected ? 'none' : 'flex';
  _renderFriendPanel(challengeMode || false);
  if (panel._wired) return;
  panel._wired = true;
  document.getElementById('friendPanelClose').onclick = function() {
    SND.ui(); panel.style.display = 'none';
    if (document.getElementById('mainMenu').style.display === 'none')
      document.getElementById('mainMenu').style.display = 'flex';
  };
  document.getElementById('friendPanelAddBtn').onclick = function() {
    SND.ui();
    var s = document.getElementById('friendPanelAddSection');
    if (s) s.style.display = s.style.display === 'none' ? 'block' : 'none';
  };
  document.getElementById('friendPanelSearchBtn').onclick = function() {
    var u = document.getElementById('friendPanelInput').value.trim();
    if (!u) return;
    if (!ONLINE.loggedIn) { document.getElementById('friendPanelSearchResult').textContent = 'Not logged in'; return; }
    onlineSend('friend_add', { username: u });
    document.getElementById('friendPanelInput').value = '';
    document.getElementById('friendPanelSearchResult').textContent = 'Request sent...';
    setTimeout(function() { var el = document.getElementById('friendPanelSearchResult'); if (el) el.textContent = ''; }, 3000);
  };
  document.getElementById('friendPanelInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('friendPanelSearchBtn').click();
  });
}

function _renderFriendPanel(challengeMode) {
  var reqEl = document.getElementById('friendPanelRequests');
  if (reqEl) {
    if (ONLINE.requests.length) {
      reqEl.innerHTML = '<div style="padding:8px 12px 4px;font-size:8px;color:#3a7a9b;letter-spacing:2px;">PENDING REQUESTS</div>'
        + ONLINE.requests.map(function(r) {
          var fu = _esc(r.from);
          return '<div class="friendItem">'
            + '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;">'+(r.avatar||'♟')+'</span>'
            + '<span style="font-size:10px;color:#6ab4d8;">'+fu+'</span></div>'
            + '<div style="display:flex;gap:4px;">'
            + '<button onclick="onlineSend(\'friend_accept\',{from:\''+fu+'\'});onlineUpdateFriends();" style="background:#040c16;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">ACCEPT</button>'
            + '<button onclick="onlineSend(\'friend_decline\',{from:\''+fu+'\'});ONLINE.requests=ONLINE.requests.filter(function(x){return x.from!==\''+fu+'\';});onlineUpdateFriends();" style="background:#040c16;border:1px solid #0a1e30;color:#4a8fb0;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">DECLINE</button>'
            + '</div></div>';
        }).join('');
    } else { reqEl.innerHTML = ''; }
  }
  var listEl = document.getElementById('friendPanelList');
  if (!listEl) return;
  if (!ONLINE.connected || !ONLINE.loggedIn) { listEl.innerHTML = ''; return; }
  if (!ONLINE.friends.length) {
    listEl.innerHTML = '<div style="padding:16px;color:#0a1e30;font-size:9px;text-align:center;letter-spacing:1px;">No friends yet — add someone above</div>';
    return;
  }
  var sorted = ONLINE.friends.slice().sort(function(a,b) {
    var o = { idle:0, queued:1, playing:2, offline:3 };
    return (o[a.status]||3) - (o[b.status]||3);
  });
  listEl.innerHTML = sorted.map(function(f) {
    var dotClass = 'fDot '+(f.status==='offline'?'offline':f.status==='playing'?'playing':f.status==='queued'?'queued':'online');
    var label    = f.status==='offline'?'offline':f.status==='playing'?'playing':f.status==='queued'?'searching':'online';
    var canChallenge = challengeMode && f.status==='idle' && !ONLINE.inMatch;
    var fu = _esc(f.username);
    return '<div class="friendItem">'
      + '<div style="display:flex;align-items:center;gap:8px;"><span class="'+dotClass+'"></span>'
      + '<div><div style="font-size:10px;color:#6ab4d8;">'+_esc(f.avatar||'♟')+' '+fu+'</div>'
      + '<div style="font-size:8px;color:#3a7a9b;">'+label+'  ·  ELO '+(f.elo||1200)+'</div></div></div>'
      + '<div style="display:flex;gap:4px;">'
      + (canChallenge ? '<button onclick="onlineSendInvite(\''+fu+'\')" style="background:#040c16;border:1px solid #00e5ff;color:#00e5ff;font-family:monospace;font-size:8px;padding:3px 8px;cursor:pointer;">PLAY</button>' : '')
      + '<button onclick="onlineRemoveFriend(\''+fu+'\')" style="background:#040c16;border:1px solid #061520;color:#0a1e30;font-family:monospace;font-size:8px;padding:3px 6px;cursor:pointer;" title="Remove">✕</button>'
      + '</div></div>';
  }).join('');
}

// Auto-connect on page load if we have a stored server URL
(function() {
  var url = localStorage.getItem('cc_server_url') || CC_DEFAULT_SERVER;
  if (url) setTimeout(function() { onlineConnect(url); }, 800);
})();

/* ================================================================
   SERVER STATUS LINE  (main menu indicator)
================================================================ */
var SERVER_URL = ONLINE_SERVER ? ONLINE_SERVER.replace(/^ws/,'http') : CC_DEFAULT_SERVER.replace(/^ws/,'http');

async function safeFetch(url, options) {
  if (localStorage.getItem('cc_online_enabled') !== '1') return null;
  try {
    return await Promise.race([
      fetch(url, options||{}),
      new Promise(function(_,rej){ setTimeout(function(){ rej(new Error('timeout')); }, 2000); })
    ]);
  } catch(e) { return null; }
}

async function checkServerStatus() {
  try {
    var res = await safeFetch(SERVER_URL + '/status');
    if (!res) return { online: false, players: 0 };
    var data = await res.json();
    return { online: true, players: data.players || 0 };
  } catch(e) { return { online: false, players: 0 }; }
}

function _updateServerStatusUI(status) {
  var el = document.getElementById('serverStatusLine');
  if (!el) return;
  var enabled = localStorage.getItem('cc_online_enabled') === '1';
  if (!enabled) { el.textContent = '⬤ OFFLINE MODE'; el.style.color = '#333'; }
  else if (status && status.online) { el.textContent = '⬤ SERVER ONLINE' + (status.players ? ' (' + status.players + ')' : ''); el.style.color = '#44ff88'; }
  else { el.textContent = '⬤ SERVER OFFLINE'; el.style.color = '#555'; }
}

(function() {
  var el = document.getElementById('serverStatusLine');
  if (!el) return;
  el.onclick = function() {
    var on = localStorage.getItem('cc_online_enabled') === '1';
    localStorage.setItem('cc_online_enabled', on ? '0' : '1');
    _updateServerStatusUI(null);
    if (!on) checkServerStatus().then(_updateServerStatusUI);
    if (typeof SND !== 'undefined') SND.ui();
  };
  _updateServerStatusUI(null);
  if (localStorage.getItem('cc_online_enabled') === '1') checkServerStatus().then(_updateServerStatusUI);
})();

// Periodically sync signal indicator with game state (catches menu-return edge cases)
setInterval(function() { if (typeof updateSignalIndicator === 'function') updateSignalIndicator(); }, 2000);

/* ================================================================
   PIECE APPEARANCE PANEL — event wiring
================================================================ */

// Which side is currently active in the Appearance editor
let _apActiveSide = 'white';

function _apCfg() {
  return _apActiveSide === 'white' ? CFG.pieces.white : CFG.pieces.black;
}

// Sync all Appearance panel controls to CFG for the active side
function syncAppearancePanelUI() {
  const cfg = _apCfg();

  // Side buttons
  document.querySelectorAll('[data-apside]').forEach(b => b.classList.toggle('active', b.dataset.apside === _apActiveSide));

  // Model chips
  document.querySelectorAll('[data-apmodel]').forEach(b => {
    b.classList.toggle('active', b.dataset.apmodel === (_glbUseModels ? 'glb' : 'procedural'));
  });

  // Material preset chips
  const preset = cfg.materialPreset || 'plastic';
  document.querySelectorAll('[data-appreset]').forEach(b => b.classList.toggle('active', b.dataset.appreset === preset));

  // Base appearance controls
  const baseColorEl = document.getElementById('apBaseColor');
  if (baseColorEl) baseColorEl.value = intToHex(cfg.color !== undefined ? cfg.color : 0xffffff);

  const opEl = document.getElementById('apOpacity');
  const opVal = document.getElementById('apOpacityVal');
  if (opEl) { const v = Math.round((cfg.baseOpacity !== undefined ? cfg.baseOpacity : 1.0) * 100); opEl.value = v; if (opVal) opVal.textContent = v + '%'; }

  const roughEl = document.getElementById('apRoughness');
  const roughVal = document.getElementById('apRoughnessVal');
  if (roughEl) { const v = Math.round((cfg.roughness !== undefined ? cfg.roughness : 0.4) * 100); roughEl.value = v; if (roughVal) roughVal.textContent = (v/100).toFixed(2); }

  const emColEl = document.getElementById('apEmissiveColor');
  if (emColEl) emColEl.value = intToHex(cfg.emissiveColor !== undefined ? cfg.emissiveColor : 0);

  const emIntEl = document.getElementById('apEmissiveInt');
  const emIntVal = document.getElementById('apEmissiveIntVal');
  if (emIntEl) { const v = Math.round((cfg.emissiveIntensity !== undefined ? cfg.emissiveIntensity : 0) * 100); emIntEl.value = v; if (emIntVal) emIntVal.textContent = (v/100).toFixed(1); }

  // Highlight style chips
  const hlStyle = cfg.highlightStyle || 'outline';
  document.querySelectorAll('[data-aphl]').forEach(b => b.classList.toggle('active', b.dataset.aphl === hlStyle));

  const hlColEl = document.getElementById('apHlColor');
  if (hlColEl) hlColEl.value = intToHex(cfg.highlightColor !== undefined ? cfg.highlightColor : (cfg.outlineColor || 0x888888));

  const thickEl = document.getElementById('apOutlineThick');
  const thickVal = document.getElementById('apOutlineThickVal');
  if (thickEl) { const v = Math.round((cfg.thickness !== undefined ? cfg.thickness : 0.038) * 500); thickEl.value = Math.min(v, 20); if (thickVal) thickVal.textContent = (cfg.thickness || 0.038).toFixed(3); }

  const selColEl = document.getElementById('apSelOutlineColor');
  if (selColEl) selColEl.value = intToHex(cfg.outlineSelColor !== undefined ? cfg.outlineSelColor : 0x00ffff);

  // Preset slots: show slot index if filled
  _refreshApSlotButtons();
}

function _refreshApSlotButtons() {
  document.querySelectorAll('[data-apslot]').forEach(btn => {
    const idx = parseInt(btn.dataset.apslot);
    const slot = CFG.piecePresetSlots && CFG.piecePresetSlots[idx];
    btn.classList.toggle('filled', !!slot);
    if (slot) {
      btn.title = 'Load: ' + (slot.materialPreset || '?') + ' / Shift+click to overwrite';
    } else {
      btn.title = 'Shift+click to save current settings';
    }
  });
}

// Appearance panel event wiring
(function() {
  // Side switcher
  document.querySelectorAll('[data-apside]').forEach(btn => {
    btn.onclick = () => {
      _apActiveSide = btn.dataset.apside;
      syncAppearancePanelUI();
    };
  });

  // Model source chips
  document.querySelectorAll('[data-apmodel]').forEach(btn => {
    btn.onclick = () => {
      const wantGLB = btn.dataset.apmodel === 'glb';
      if (wantGLB === _glbUseModels) return;
      _glbUseModels = wantGLB;
      document.querySelectorAll('[data-apmodel]').forEach(b => b.classList.toggle('active', b.dataset.apmodel === (wantGLB ? 'glb' : 'procedural')));
      if (_glbLoadDone || !wantGLB) _rebuildAllPiecesGeometry();
    };
  });

  // Material preset chips
  document.querySelectorAll('[data-appreset]').forEach(btn => {
    btn.onclick = () => {
      const cfg = _apCfg();
      cfg.materialPreset = btn.dataset.appreset;
      document.querySelectorAll('[data-appreset]').forEach(b => b.classList.toggle('active', b.dataset.appreset === cfg.materialPreset));
      applyPieceAppearance();
      if (_prevRafId) { _loadPrevPiece(PREV_TYPES[_prevIdx]); }
    };
  });

  // Base color
  const baseColorEl = document.getElementById('apBaseColor');
  if (baseColorEl) baseColorEl.oninput = () => {
    _apCfg().color = hexToInt(baseColorEl.value);
    applyPieceAppearance();
    if (_prevRafId) _loadPrevPiece(PREV_TYPES[_prevIdx]);
  };

  // Opacity slider
  const opEl = document.getElementById('apOpacity');
  const opVal = document.getElementById('apOpacityVal');
  if (opEl) opEl.oninput = () => {
    _apCfg().baseOpacity = parseInt(opEl.value) / 100;
    if (opVal) opVal.textContent = opEl.value + '%';
    applyPieceAppearance();
  };

  // Roughness slider
  const roughEl = document.getElementById('apRoughness');
  const roughVal = document.getElementById('apRoughnessVal');
  if (roughEl) roughEl.oninput = () => {
    const v = parseInt(roughEl.value) / 100;
    _apCfg().roughness = v;
    if (roughVal) roughVal.textContent = v.toFixed(2);
    applyPieceAppearance();
  };

  // Emissive color
  const emColEl = document.getElementById('apEmissiveColor');
  if (emColEl) emColEl.oninput = () => {
    _apCfg().emissiveColor = hexToInt(emColEl.value);
    applyPieceAppearance();
  };

  // Emissive intensity slider
  const emIntEl = document.getElementById('apEmissiveInt');
  const emIntVal = document.getElementById('apEmissiveIntVal');
  if (emIntEl) emIntEl.oninput = () => {
    const v = parseInt(emIntEl.value) / 100;
    _apCfg().emissiveIntensity = v;
    if (emIntVal) emIntVal.textContent = v.toFixed(1);
    applyPieceAppearance();
  };

  // Highlight style chips
  document.querySelectorAll('[data-aphl]').forEach(btn => {
    btn.onclick = () => {
      _apCfg().highlightStyle = btn.dataset.aphl;
      document.querySelectorAll('[data-aphl]').forEach(b => b.classList.toggle('active', b.dataset.aphl === btn.dataset.aphl));
      applyPieceAppearance();
    };
  });

  // Highlight color
  const hlColEl = document.getElementById('apHlColor');
  if (hlColEl) hlColEl.oninput = () => {
    const cfg = _apCfg();
    const c = hexToInt(hlColEl.value);
    cfg.highlightColor = c;
    cfg.outlineColor = c; // keep in sync for existing setOutlineColor() calls
    applyPieceAppearance();
  };

  // Outline thickness
  const thickEl = document.getElementById('apOutlineThick');
  const thickVal = document.getElementById('apOutlineThickVal');
  if (thickEl) thickEl.oninput = () => {
    const v = parseInt(thickEl.value) / 500;
    _apCfg().thickness = v;
    if (thickVal) thickVal.textContent = v.toFixed(3);
    applyPieceAppearance();
  };

  // Selection outline color
  const selColEl = document.getElementById('apSelOutlineColor');
  if (selColEl) selColEl.oninput = () => {
    _apCfg().outlineSelColor = hexToInt(selColEl.value);
    applyPieceAppearance();
  };

  // Preset slots
  document.querySelectorAll('[data-apslot]').forEach(btn => {
    btn.onclick = (e) => {
      const idx = parseInt(btn.dataset.apslot);
      if (e.shiftKey) {
        // Save current side config to slot
        const cfg = _apCfg();
        CFG.piecePresetSlots[idx] = JSON.parse(JSON.stringify(cfg));
        _refreshApSlotButtons();
        saveCFGToStorage();
        if (typeof SND !== 'undefined') SND.confirm();
      } else {
        // Load from slot
        const slot = CFG.piecePresetSlots && CFG.piecePresetSlots[idx];
        if (!slot) return;
        const cfg = _apCfg();
        Object.assign(cfg, slot);
        syncAppearancePanelUI();
        applyPieceAppearance();
        if (typeof SND !== 'undefined') SND.ui();
      }
    };
  });
})();

// Sync appearance panel when its tab is activated
// (advTab onclick already calls drawSettingsPreview, we hook into that)
const _origDrawSettingsPreview = drawSettingsPreview;
drawSettingsPreview = function(page) {
  _origDrawSettingsPreview(page);
  if (page === 'pageAppearance') syncAppearancePanelUI();
};

/* ============================================================
   UI HIDE TOGGLE
   ============================================================ */
(function() {
  const UI_HIDE_IDS = [
    'menuBtn','hud','botThinkingEl','moveToggle','viewToggle','movePanel',
    'zSlider','rotateBoardBtn','hintBtn','undoBtn','panBoardBtn','layerVisToggle',
    'gameBar','moveNumBar','reviewControls','layerFlash','arcadeEventBanner',
    'arcadeBar','clockW','clockB','clockToggleBtn','onlineColorIndicator',
    'offlineBanner',
    'onlineStatusBar', 'onlineWidget', 'signalIndicator',
    'hudGearBtn', 'hudQuickPanel',
    'puzzleInfoToggle', 'puzzleInfoPopup'
  ];
  // Expose hidden state globally so intervals/functions can respect it
  window._uiHidden = false;

  const btn = document.getElementById('uiHideBtn');
  if (!btn) return;

  // Snapshot display state before hiding so we restore exactly what was there
  var _savedDisplays = {};

  btn.addEventListener('click', function() {
    window._uiHidden = !window._uiHidden;
    btn.textContent = window._uiHidden ? '▣' : '◻';
    btn.style.color = window._uiHidden ? '#00ccff' : '#666';
    btn.style.borderColor = window._uiHidden ? '#00ccff55' : '#333';

    if (window._uiHidden) {
      // Save each element's current display before hiding
      UI_HIDE_IDS.forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;
        _savedDisplays[id] = el.style.display;
        el.style.setProperty('display', 'none', 'important');
      });
    } else {
      // Restore exactly what each element showed before the hide
      UI_HIDE_IDS.forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;
        var saved = _savedDisplays[id];
        el.style.removeProperty('display');
        if (saved) el.style.display = saved;
      });
    }

    // Minimap and offlineBanner are managed by their own intervals —
    // use a CSS class on body so their logic can gate on it
    document.body.classList.toggle('ui-hidden', window._uiHidden);
  });
})();

/* ============================================================
   MOBILE PAN — expose pan state globally for touch handler
   ============================================================ */
// _panModeActive is set inside initPCInput; we expose it via window
// so the touch handler below can read it.
// The touchmove handler patches itself here to support pan.
(function patchTouchPan() {
  // _doBoardPanGlobal: replicates initPCInput's _doBoardPan using globals
  var _panUpTouch = new THREE.Vector3();
  window._doBoardPanTouch = function(dx, dy) {
    if (typeof camera === 'undefined' || typeof pivot === 'undefined') return;
    // Screen-vertical pan — must stay identical to _doBoardPan in
    // 18_ctf_input.js, which explains why the axis is the camera's up vector
    // and not world Y. Touch and mouse pan the same board; if only one of them
    // is converted the gesture means two different things per input device.
    var la = (typeof _camLookAt !== 'undefined') ? _camLookAt : new THREE.Vector3();
    var dist = camera.position.distanceTo(la);
    var scale = dist * 0.0012;
    _panUpTouch.set(0, 1, 0).applyQuaternion(camera.quaternion);
    pivot.position.addScaledVector(_panUpTouch, -dy * scale);
  };
})();

