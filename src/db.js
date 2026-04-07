// SQLite session persistence
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class SessionStore {
  constructor(dbPath) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        claude_session_id TEXT,
        created_at INTEGER NOT NULL,
        last_active INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channel);
      CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(last_active);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    `);

    this.stmts = {
      createSession: this.db.prepare(`
        INSERT INTO sessions (id, user_id, channel, created_at, last_active, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getSession: this.db.prepare('SELECT * FROM sessions WHERE id = ?'),
      getSessionByUserChannel: this.db.prepare(
        'SELECT * FROM sessions WHERE user_id = ? AND channel = ? ORDER BY last_active DESC LIMIT 1'
      ),
      listSessions: this.db.prepare('SELECT * FROM sessions ORDER BY last_active DESC LIMIT ?'),
      updateClaudeSessionId: this.db.prepare(
        'UPDATE sessions SET claude_session_id = ?, last_active = ? WHERE id = ?'
      ),
      bumpActivity: this.db.prepare(
        'UPDATE sessions SET last_active = ?, message_count = message_count + 1 WHERE id = ?'
      ),
      deleteSession: this.db.prepare('DELETE FROM sessions WHERE id = ?'),
      addMessage: this.db.prepare(
        'INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)'
      ),
      getMessages: this.db.prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?'
      )
    };
  }

  createSession({ id, userId, channel, metadata = {} }) {
    const now = Date.now();
    this.stmts.createSession.run(id, userId, channel, now, now, JSON.stringify(metadata));
    return this.getSession(id);
  }

  getSession(id) {
    return this.stmts.getSession.get(id);
  }

  findSession(userId, channel) {
    return this.stmts.getSessionByUserChannel.get(userId, channel);
  }

  listSessions(limit = 100) {
    return this.stmts.listSessions.all(limit);
  }

  setClaudeSessionId(id, claudeSessionId) {
    this.stmts.updateClaudeSessionId.run(claudeSessionId, Date.now(), id);
  }

  bumpActivity(id) {
    this.stmts.bumpActivity.run(Date.now(), id);
  }

  deleteSession(id) {
    this.stmts.deleteSession.run(id);
  }

  addMessage(sessionId, role, content) {
    this.stmts.addMessage.run(sessionId, role, content, Date.now());
  }

  getMessages(sessionId, limit = 100) {
    return this.stmts.getMessages.all(sessionId, limit);
  }

  close() {
    this.db.close();
  }
}
