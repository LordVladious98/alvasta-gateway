// Session persistence — plain JSON file store.
//
// Why JSON instead of SQLite:
// - No native compilation (better-sqlite3 needs Visual Studio on Windows)
// - Zero npm dependencies
// - Works on every platform without build tools
// - Sessions are small and few; SQL features are unnecessary here
//
// Format: ~/.alvasta/sessions.json
// {
//   "sessions": {
//     "<session_id>": {
//       "id", "user_id", "channel", "claude_session_id",
//       "created_at", "last_active", "message_count", "metadata"
//     }
//   },
//   "messages": {
//     "<session_id>": [{ "role", "content", "timestamp" }, ...]
//   }
// }
//
// Writes are atomic: write to .tmp, then rename.
// Holds the working set in memory; flushes on every mutation.

import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT = { sessions: {}, messages: {} };

export class SessionStore {
  constructor(filePath) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.path = filePath;
    this.tmpPath = filePath + '.tmp';
    this.data = this.load();
    this.flushTimer = null;
  }

  load() {
    if (!existsSync(this.path)) {
      return JSON.parse(JSON.stringify(DEFAULT));
    }
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        sessions: parsed.sessions || {},
        messages: parsed.messages || {}
      };
    } catch (err) {
      console.error('[db] failed to load, starting fresh:', err.message);
      return JSON.parse(JSON.stringify(DEFAULT));
    }
  }

  flush() {
    // Atomic write: write to .tmp then rename
    const json = JSON.stringify(this.data, null, 2);
    writeFileSync(this.tmpPath, json);
    renameSync(this.tmpPath, this.path);
  }

  // Debounced flush — coalesces rapid writes
  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try { this.flush(); } catch (e) { console.error('[db] flush error:', e.message); }
    }, 100);
  }

  // ── Session API (same shape as the old better-sqlite3 version) ──

  createSession({ id, userId, channel, metadata = {} }) {
    const now = Date.now();
    const session = {
      id,
      user_id: userId,
      channel,
      claude_session_id: null,
      created_at: now,
      last_active: now,
      message_count: 0,
      metadata
    };
    this.data.sessions[id] = session;
    this.scheduleFlush();
    return session;
  }

  getSession(id) {
    return this.data.sessions[id] || null;
  }

  findSession(userId, channel) {
    // Most-recent session for this (user, channel) pair
    const matches = Object.values(this.data.sessions)
      .filter(s => s.user_id === userId && s.channel === channel)
      .sort((a, b) => b.last_active - a.last_active);
    return matches[0] || null;
  }

  listSessions(limit = 100) {
    return Object.values(this.data.sessions)
      .sort((a, b) => b.last_active - a.last_active)
      .slice(0, limit);
  }

  setClaudeSessionId(id, claudeSessionId) {
    const s = this.data.sessions[id];
    if (!s) return;
    s.claude_session_id = claudeSessionId;
    s.last_active = Date.now();
    this.scheduleFlush();
  }

  bumpActivity(id) {
    const s = this.data.sessions[id];
    if (!s) return;
    s.last_active = Date.now();
    s.message_count = (s.message_count || 0) + 1;
    this.scheduleFlush();
  }

  deleteSession(id) {
    delete this.data.sessions[id];
    delete this.data.messages[id];
    this.scheduleFlush();
  }

  addMessage(sessionId, role, content) {
    if (!this.data.messages[sessionId]) {
      this.data.messages[sessionId] = [];
    }
    this.data.messages[sessionId].push({ role, content, timestamp: Date.now() });
    // Cap at 1000 messages per session to keep the file from blowing up
    if (this.data.messages[sessionId].length > 1000) {
      this.data.messages[sessionId] = this.data.messages[sessionId].slice(-1000);
    }
    this.scheduleFlush();
  }

  getMessages(sessionId, limit = 100) {
    const all = this.data.messages[sessionId] || [];
    return all.slice(-limit);
  }

  close() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try { this.flush(); } catch {}
  }
}
