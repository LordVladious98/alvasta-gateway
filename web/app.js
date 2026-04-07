// ALVASTA GATEWAY :: WEB UI
// Connects to the gateway via WebSocket on the same origin (port 18789).

const ui = {
  statusPill:    document.getElementById('statusPill'),
  statusText:    document.querySelector('.status-text'),
  statusDot:     document.querySelector('.status-pill .dot'),
  metaPort:      document.getElementById('metaPort'),
  metaHost:      document.getElementById('metaHost'),
  metaSessions:  document.getElementById('metaSessions'),
  metaClients:   document.getElementById('metaClients'),
  sessionList:   document.getElementById('sessionList'),
  sessionLabel:  document.getElementById('sessionLabel'),
  messages:      document.getElementById('messages'),
  composer:      document.getElementById('composer'),
  input:         document.getElementById('input'),
  sendBtn:       document.getElementById('sendBtn'),
  clearBtn:      document.getElementById('clearBtn'),
  reconnectBtn:  document.getElementById('reconnectBtn'),
  eventLog:      document.getElementById('eventLog')
};

// ── State ──
const state = {
  ws: null,
  sessionId: null,
  userId: 'web-' + Math.random().toString(36).slice(2, 10),
  busy: false,
  currentMsgEl: null,
  currentMsgBuf: ''
};

// ── Helpers ──
function setStatus(state, text) {
  ui.statusDot.className = 'dot dot-' + state;
  ui.statusText.textContent = text;
}

function logEvent(type, text) {
  const ev = document.createElement('div');
  ev.className = 'ev ev-' + type;
  const t = new Date().toTimeString().slice(0, 8);
  ev.innerHTML = `<span class="ev-time">[${t}]</span>${text}`;
  ui.eventLog.appendChild(ev);
  ui.eventLog.scrollTop = ui.eventLog.scrollHeight;
  // Cap at 200 events
  while (ui.eventLog.children.length > 200) {
    ui.eventLog.removeChild(ui.eventLog.firstChild);
  }
}

function addMessage(role, text, opts = {}) {
  const el = document.createElement('div');
  el.className = 'msg msg-' + role;
  if (opts.streaming) el.classList.add('msg-streaming');
  el.innerHTML = `
    <div class="msg-meta">// ${role}</div>
    <div class="msg-body"></div>
  `;
  el.querySelector('.msg-body').textContent = text;
  ui.messages.appendChild(el);
  ui.messages.scrollTop = ui.messages.scrollHeight;
  return el;
}

// ── Status polling ──
async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    ui.metaPort.textContent = data.port;
    ui.metaHost.textContent = data.host;
    ui.metaSessions.textContent = data.activeSessions;
    ui.metaClients.textContent = data.connectedClients;
    renderSessions(data.sessions || []);
  } catch (e) {
    // ignore
  }
}

function renderSessions(ids) {
  if (ids.length === 0) {
    ui.sessionList.innerHTML = '<li class="empty">no sessions yet</li>';
    return;
  }
  ui.sessionList.innerHTML = '';
  ids.forEach(id => {
    const li = document.createElement('li');
    li.textContent = id.length > 28 ? id.slice(0, 25) + '...' : id;
    li.title = id;
    if (id === state.sessionId) li.classList.add('active');
    li.addEventListener('click', () => switchSession(id));
    ui.sessionList.appendChild(li);
  });
}

// ── Session switching ──
function switchSession(targetSessionId) {
  if (targetSessionId === state.sessionId) return;
  // Parse the session id format: <channel>-<userId>-<random>
  // Example: web-web-i26d691b-a714b1d9
  const parts = targetSessionId.split('-');
  if (parts.length < 3) return;
  // The user_id is everything between channel and the random suffix
  const channel = parts[0];
  const userId = parts.slice(1, -1).join('-');

  logEvent('orange', 'switching to ' + targetSessionId.slice(0, 16) + '...');
  // Clear chat and reconnect with the target user_id
  ui.messages.innerHTML = '';
  state.userId = userId;
  if (state.ws) state.ws.close();
  setTimeout(connect, 100);
}

// ── WebSocket ──
function connect() {
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  setStatus('pending', 'connecting...');
  logEvent('info', `connecting to ${wsUrl}`);

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    logEvent('ok', 'websocket open');
    state.ws.send(JSON.stringify({
      type: 'auth',
      user_id: state.userId,
      channel: 'web'
    }));
  };

  state.ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleGatewayMessage(msg);
  };

  state.ws.onclose = () => {
    setStatus('fail', 'disconnected');
    logEvent('err', 'websocket closed');
    state.busy = false;
    ui.sendBtn.disabled = false;
  };

  state.ws.onerror = () => {
    setStatus('fail', 'error');
    logEvent('err', 'websocket error');
  };
}

function handleGatewayMessage(msg) {
  switch (msg.type) {
    case 'session':
      state.sessionId = msg.session_id;
      ui.sessionLabel.textContent = msg.session_id;
      setStatus('ok', 'connected');
      logEvent('orange', 'session: ' + msg.session_id);
      break;

    case 'text':
      if (!state.currentMsgEl) {
        state.currentMsgEl = addMessage('assistant', '', { streaming: true });
        state.currentMsgBuf = '';
      }
      state.currentMsgBuf += msg.delta;
      state.currentMsgEl.querySelector('.msg-body').textContent = state.currentMsgBuf;
      ui.messages.scrollTop = ui.messages.scrollHeight;
      break;

    case 'event':
      // Compact event logging
      if (msg.event?.type && msg.event.type !== 'assistant' && msg.event.type !== 'rate_limit_event') {
        const t = msg.event.type;
        const sub = msg.event.subtype ? ':' + msg.event.subtype : '';
        logEvent('dim', t + sub);
      }
      break;

    case 'done': {
      const finalText = state.currentMsgBuf;
      if (state.currentMsgEl) {
        state.currentMsgEl.classList.remove('msg-streaming');
        state.currentMsgEl = null;
        state.currentMsgBuf = '';
      }
      state.busy = false;
      ui.sendBtn.disabled = false;
      const cost = msg.result?.total_cost_usd;
      const dur = msg.result?.duration_ms;
      logEvent('ok', `done${dur ? ` ${dur}ms` : ''}${cost ? ` $${cost.toFixed(4)}` : ''}`);
      // Speak response aloud if voice output is enabled
      if (typeof speakText === 'function' && finalText) speakText(finalText);
      break;
    }

    case 'error':
      addMessage('error', msg.error);
      logEvent('err', msg.error);
      state.busy = false;
      ui.sendBtn.disabled = false;
      break;
  }
}

// ── Send ──
function send(text) {
  if (!text.trim() || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  if (state.busy) return;
  state.busy = true;
  ui.sendBtn.disabled = true;
  addMessage('user', text);
  state.ws.send(JSON.stringify({ type: 'message', text }));
  logEvent('info', `→ ${text.length} chars`);
}

// ── Wire UI ──
ui.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = ui.input.value;
  if (!text.trim()) return;
  send(text);
  ui.input.value = '';
  ui.input.style.height = '';
});

ui.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    ui.composer.dispatchEvent(new Event('submit'));
  }
});

// Auto-resize textarea
ui.input.addEventListener('input', () => {
  ui.input.style.height = 'auto';
  ui.input.style.height = Math.min(200, ui.input.scrollHeight) + 'px';
});

ui.clearBtn.addEventListener('click', () => {
  ui.messages.innerHTML = '';
});

ui.reconnectBtn.addEventListener('click', () => {
  if (state.ws) state.ws.close();
  connect();
});

const newSessionBtn = document.getElementById('newSessionBtn');
if (newSessionBtn) {
  newSessionBtn.addEventListener('click', () => {
    state.userId = 'web-' + Math.random().toString(36).slice(2, 10);
    ui.messages.innerHTML = '';
    if (state.ws) state.ws.close();
    setTimeout(connect, 100);
    logEvent('orange', 'started new session');
  });
}

// ── Service worker (PWA install + offline shell) ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ── Voice: speech-to-text via Web Speech API ──
const micBtn = document.getElementById('micBtn');
const voiceStatus = document.getElementById('voiceStatus');
const speakToggle = document.getElementById('speakToggle');
let recognition = null;
let recognizing = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition && micBtn) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = navigator.language || 'en-US';

  recognition.onstart = () => {
    recognizing = true;
    micBtn.classList.add('recording');
    voiceStatus.textContent = '● listening...';
  };
  recognition.onend = () => {
    recognizing = false;
    micBtn.classList.remove('recording');
    voiceStatus.textContent = '';
  };
  recognition.onerror = (e) => {
    voiceStatus.textContent = 'mic error: ' + e.error;
    micBtn.classList.remove('recording');
    recognizing = false;
  };
  recognition.onresult = (e) => {
    let finalText = '';
    let interimText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interimText += r[0].transcript;
    }
    if (interimText) {
      ui.input.value = interimText;
    }
    if (finalText) {
      ui.input.value = finalText.trim();
      // Auto-send on final result
      setTimeout(() => {
        if (ui.input.value.trim()) {
          ui.composer.dispatchEvent(new Event('submit'));
        }
      }, 200);
    }
  };

  micBtn.addEventListener('click', () => {
    if (recognizing) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (e) {
        voiceStatus.textContent = 'mic blocked';
      }
    }
  });
} else if (micBtn) {
  micBtn.disabled = true;
  micBtn.title = 'Speech recognition not supported in this browser. Use Chrome/Edge/Safari.';
  micBtn.style.opacity = '0.4';
}

// ── Voice: text-to-speech ──
function speakText(text) {
  if (!speakToggle?.checked) return;
  if (!('speechSynthesis' in window)) return;
  // Strip markdown / code blocks for cleaner speech
  const clean = text.replace(/```[\s\S]*?```/g, ' code block ').replace(/[*_`#]/g, '').slice(0, 1000);
  if (!clean.trim()) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 1.05;
  u.lang = navigator.language || 'en-US';
  speechSynthesis.cancel(); // stop any in-flight
  speechSynthesis.speak(u);
}

// (speakText is called directly from handleGatewayMessage's 'done' branch above)

// ── Boot ──
connect();
pollStatus();
setInterval(pollStatus, 5000);
