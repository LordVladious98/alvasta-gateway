// Alvasta Gateway — WebSocket server that routes channel adapters
// to per-session Claude Code agent runners.
//
// Protocol (JSON over WebSocket):
//
// CLIENT → GATEWAY:
//   { type: "auth",    user_id: string, channel: string, token?: string }
//   { type: "message", text: string }
//   { type: "stop" }
//   { type: "ping" }
//
// GATEWAY → CLIENT:
//   { type: "session",   session_id: string }
//   { type: "text",      delta: string }
//   { type: "event",     event: object }     // raw stream-json passthrough
//   { type: "done",      result: object }
//   { type: "error",     error: string }
//   { type: "pong" }

import { WebSocketServer } from 'ws';
import { SessionStore } from './db.js';
import { SessionManager } from './session.js';

export class AlvastaGateway {
  constructor({
    port = 18789,
    host = '127.0.0.1',
    dbPath,
    workingDir = process.cwd(),
    agentOptions = {},
    auth = null
  } = {}) {
    this.port = port;
    this.host = host;
    this.workingDir = workingDir;
    this.auth = auth; // optional fn(userId, channel, token) -> bool
    this.store = new SessionStore(dbPath);
    this.manager = new SessionManager({
      store: this.store,
      workingDir,
      agentOptions
    });
    this.wss = null;
    this.clients = new Map(); // ws -> { sessionId, userId, channel }
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port, host: this.host });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    // Forward manager events to subscribed clients
    this.manager.on('text', ({ sessionId, text }) => {
      this.broadcastToSession(sessionId, { type: 'text', delta: text });
    });
    this.manager.on('event', ({ sessionId, event }) => {
      this.broadcastToSession(sessionId, { type: 'event', event });
    });
    this.manager.on('done', ({ sessionId, result }) => {
      this.broadcastToSession(sessionId, { type: 'done', result });
    });
    this.manager.on('runner-error', ({ sessionId, error }) => {
      this.broadcastToSession(sessionId, { type: 'error', error });
    });

    console.log(`[gateway] listening on ws://${this.host}:${this.port}`);
    console.log(`[gateway] working dir: ${this.workingDir}`);
  }

  handleConnection(ws, req) {
    const ip = req.socket.remoteAddress;
    console.log(`[gateway] connection from ${ip}`);
    this.clients.set(ws, null);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return this.sendError(ws, 'Invalid JSON');
      }

      try {
        await this.handleMessage(ws, msg);
      } catch (err) {
        console.error('[gateway] handler error:', err);
        this.sendError(ws, err.message);
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[gateway] client disconnected from ${ip}`);
    });
  }

  async handleMessage(ws, msg) {
    switch (msg.type) {
      case 'auth':
        return this.handleAuth(ws, msg);
      case 'message':
        return this.handleUserMessage(ws, msg);
      case 'stop':
        return this.handleStop(ws);
      case 'ping':
        return this.send(ws, { type: 'pong' });
      default:
        return this.sendError(ws, `Unknown message type: ${msg.type}`);
    }
  }

  async handleAuth(ws, msg) {
    const { user_id, channel, token, metadata } = msg;
    if (!user_id || !channel) {
      return this.sendError(ws, 'auth requires user_id and channel');
    }
    if (this.auth && !this.auth(user_id, channel, token)) {
      return this.sendError(ws, 'unauthorized');
    }

    const session = await this.manager.getOrCreate(user_id, channel, metadata || {});
    this.clients.set(ws, {
      sessionId: session.id,
      userId: user_id,
      channel
    });
    this.send(ws, { type: 'session', session_id: session.id });
    console.log(`[gateway] auth ok :: ${user_id}@${channel} → ${session.id}`);
  }

  handleUserMessage(ws, msg) {
    const client = this.clients.get(ws);
    if (!client?.sessionId) {
      return this.sendError(ws, 'not authenticated');
    }
    if (!msg.text) {
      return this.sendError(ws, 'message requires text');
    }
    this.manager.send(client.sessionId, msg.text);
  }

  handleStop(ws) {
    const client = this.clients.get(ws);
    if (!client?.sessionId) return;
    this.manager.stop(client.sessionId);
  }

  broadcastToSession(sessionId, message) {
    for (const [ws, client] of this.clients.entries()) {
      if (client?.sessionId === sessionId && ws.readyState === ws.OPEN) {
        this.send(ws, message);
      }
    }
  }

  send(ws, obj) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  sendError(ws, error) {
    this.send(ws, { type: 'error', error });
  }

  stop() {
    this.manager.stopAll();
    if (this.wss) this.wss.close();
    this.store.close();
  }

  status() {
    return {
      port: this.port,
      host: this.host,
      activeSessions: this.manager.getActiveCount(),
      sessions: this.manager.getActiveSessionIds(),
      connectedClients: this.clients.size
    };
  }
}
