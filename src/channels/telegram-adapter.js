// Telegram channel adapter
// - Long-polls Telegram getUpdates
// - For each message, opens a WebSocket session to the gateway
// - Streams text deltas back as Telegram message edits
// - First message claims ownership; allowlist locks others out
//
// Run as: node src/channels/telegram-adapter.js
// Or as a child of the main daemon (future).

import { WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';
import { loadConfig, saveConfig, color, ok, fail, info } from '../cli/util.js';

const POLL_TIMEOUT = 30; // seconds (long-polling)
const EDIT_INTERVAL_MS = 600; // throttle edits to avoid Telegram rate limits
const MAX_MESSAGE_LEN = 4000;

class TelegramAdapter {
  constructor({ token, gatewayUrl, allowlist = [], ownerChatId = null, pairCode = null, onAllowlistUpdate }) {
    this.token = token;
    this.api = `https://api.telegram.org/bot${token}`;
    this.gatewayUrl = gatewayUrl;
    this.allowlist = new Set(allowlist);
    this.ownerChatId = ownerChatId;
    this.pairCode = pairCode; // if set, claiming requires sending this code
    this.onAllowlistUpdate = onAllowlistUpdate;
    this.offset = 0;
    this.running = false;
    this.activeSessions = new Map(); // chatId -> { ws, pendingMessageId, buffer, lastEditAt }
  }

  async start() {
    this.running = true;
    info(`telegram :: polling ${this.api.replace(this.token, '***')}`);
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (err) {
        console.error('[telegram] poll error:', err.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  stop() {
    this.running = false;
    for (const [chatId, sess] of this.activeSessions) {
      sess.ws.close();
    }
    this.activeSessions.clear();
  }

  async pollOnce() {
    const url = `${this.api}/getUpdates?offset=${this.offset}&timeout=${POLL_TIMEOUT}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.description || 'getUpdates failed');
    }
    for (const update of data.result) {
      this.offset = update.update_id + 1;
      if (update.message) {
        await this.handleMessage(update.message).catch(err => {
          console.error('[telegram] handle error:', err);
        });
      }
    }
  }

  async handleMessage(message) {
    const chatId = String(message.chat.id);
    const userId = String(message.from?.id || chatId);
    const text = message.text || '';

    if (!text) return; // ignore non-text for now

    // Ownership claim — protected by pairing code if one is set
    if (!this.ownerChatId) {
      // If a pair code is required, the message must contain it
      if (this.pairCode) {
        if (!text.includes(this.pairCode)) {
          info(`telegram :: rejected pair attempt from ${chatId} (no/wrong code)`);
          await this.sendMessage(chatId, '🔒 This Alvasta instance requires a pairing code to claim ownership. The owner can generate one with: alvasta channel pair telegram');
          return;
        }
        info(`telegram :: pair code matched, claiming owner ${chatId}`);
      }

      this.ownerChatId = chatId;
      this.allowlist.add(chatId);
      this.pairCode = null; // single-use
      info(`telegram :: owner claimed: ${chatId} (${message.from?.first_name})`);
      this.onAllowlistUpdate?.({
        ownerChatId: chatId,
        allowlist: [...this.allowlist],
        pairCode: null
      });
      await this.sendMessage(chatId, `✓ Paired. Welcome ${message.from?.first_name} — you're now the owner of this Alvasta instance. Send any message to start.`);
      return;
    }

    // Allowlist enforcement
    if (!this.allowlist.has(chatId)) {
      info(`telegram :: rejected message from non-allowlist chat ${chatId}`);
      await this.sendMessage(chatId, 'This Alvasta instance is private. Contact the owner for access.');
      return;
    }

    // Slash commands handled locally
    if (text.startsWith('/start')) {
      return this.sendMessage(chatId, 'Hi. Just send a message and I\'ll respond. Use /status, /memory, /resume.');
    }
    if (text.startsWith('/help')) {
      return this.sendMessage(chatId, 'Commands:\n/status — Alvasta status\n/memory — show memory\n/resume — last project\n/help — this');
    }

    // Open or reuse a session for this chat
    await this.routeToGateway(chatId, userId, message.from?.first_name || 'user', text);
  }

  async routeToGateway(chatId, userId, name, text) {
    let sess = this.activeSessions.get(chatId);

    if (!sess) {
      // Open WebSocket
      const ws = new WebSocket(this.gatewayUrl);
      sess = {
        ws,
        pendingMessageId: null,
        buffer: '',
        lastEditAt: 0,
        ready: false
      };
      this.activeSessions.set(chatId, sess);

      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('gateway connect timeout')), 5000);
        ws.on('open', () => {
          clearTimeout(t);
          ws.send(JSON.stringify({
            type: 'auth',
            user_id: userId,
            channel: 'telegram',
            metadata: { name, chatId }
          }));
        });
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'session') {
            sess.ready = true;
            resolve();
          }
        });
        ws.on('error', reject);
      });

      // Continuous handler for streaming responses
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        this.handleGatewayMessage(chatId, msg);
      });
      ws.on('close', () => this.activeSessions.delete(chatId));
      ws.on('error', () => this.activeSessions.delete(chatId));
    }

    // Reset buffer state for new message turn
    sess.buffer = '';
    sess.pendingMessageId = null;
    sess.sending = false; // serialization lock for sendOrEdit

    // Send "typing..." indicator
    fetch(`${this.api}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' })
    }).catch(() => {});

    // Forward to gateway
    sess.ws.send(JSON.stringify({ type: 'message', text }));
  }

  async handleGatewayMessage(chatId, msg) {
    const sess = this.activeSessions.get(chatId);
    if (!sess) return;

    if (msg.type === 'text') {
      sess.buffer += msg.delta;
      const now = Date.now();
      if (now - sess.lastEditAt < EDIT_INTERVAL_MS) return; // throttle
      sess.lastEditAt = now;
      await this.sendOrEdit(chatId, sess);
    } else if (msg.type === 'done') {
      // Final flush
      await this.sendOrEdit(chatId, sess, true);
    } else if (msg.type === 'error') {
      await this.sendMessage(chatId, '⚠ Error: ' + msg.error);
    }
  }

  async sendOrEdit(chatId, sess, final = false) {
    // Serialization lock — prevent two concurrent sends/edits.
    // Without this, a 'text' delta and a 'done' event arriving in quick
    // succession both find pendingMessageId === null and each create their
    // own Telegram message, resulting in duplicate responses.
    if (sess.sending && !final) return;
    if (sess.sending && final) {
      // Wait for the in-flight send to finish before flushing
      while (sess.sending) await new Promise(r => setTimeout(r, 30));
    }

    const text = sess.buffer.slice(0, MAX_MESSAGE_LEN) + (sess.buffer.length > MAX_MESSAGE_LEN ? '\n[truncated]' : '');
    if (!text.trim()) return;

    sess.sending = true;
    try {
      if (!sess.pendingMessageId) {
        // Send first message — claim a placeholder id immediately to prevent
        // re-entry from creating a second message before we get the real id back
        sess.pendingMessageId = 'pending';
        const res = await fetch(`${this.api}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text })
        });
        const data = await res.json();
        if (data.ok) {
          sess.pendingMessageId = data.result.message_id;
        } else {
          // Roll back so a retry can happen
          sess.pendingMessageId = null;
        }
      } else if (sess.pendingMessageId !== 'pending') {
        // Edit existing message
        await fetch(`${this.api}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: sess.pendingMessageId,
            text
          })
        }).catch(() => {});
      }
    } finally {
      sess.sending = false;
    }
  }

  async sendMessage(chatId, text) {
    return fetch(`${this.api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  }
}

// Standalone runner — cross-platform check using pathToFileURL
// (Windows paths use backslashes, so the naive `file://${path}` check fails there)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const tg = config.channels.telegram;
  if (!tg?.enabled || !tg.token) {
    console.error('Telegram channel not configured. Run: alvasta onboard');
    process.exit(1);
  }
  const gatewayUrl = `ws://${config.host}:${config.port}`;
  const adapter = new TelegramAdapter({
    token: tg.token,
    gatewayUrl,
    allowlist: tg.allowlist || [],
    ownerChatId: tg.ownerChatId,
    pairCode: tg.pairCode || null,
    onAllowlistUpdate: ({ ownerChatId, allowlist, pairCode }) => {
      const c = loadConfig();
      c.channels.telegram.ownerChatId = ownerChatId;
      c.channels.telegram.allowlist = allowlist;
      if (pairCode === null) delete c.channels.telegram.pairCode;
      saveConfig(c);
    }
  });
  process.on('SIGINT', () => { adapter.stop(); process.exit(0); });
  adapter.start().catch(err => {
    console.error('telegram adapter crashed:', err);
    process.exit(1);
  });
}

export { TelegramAdapter };
