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
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { SessionStore } from './db.js';
import { SessionManager } from './session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, '../web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

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
    this.adapters = new Map(); // channelName -> ChildProcess
  }

  start() {
    // HTTP server serves the web UI on /, GET endpoints on /api/*, and upgrades to WS on /ws
    this.http = createServer((req, res) => this.handleHttp(req, res));

    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      // Accept WS upgrades on / and /ws (so existing clients keep working)
      if (req.url === '/' || req.url === '/ws') {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });
    this.http.listen(this.port, this.host);

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
    console.log(`[gateway] http://${this.host}:${this.port} → web ui`);
    console.log(`[gateway] working dir: ${this.workingDir}`);

    // Start configured channel adapters as child processes
    setTimeout(() => this.startChannels(), 200);
  }

  startChannels() {
    // Read user config to find enabled channels
    const configPath = process.env.ALVASTA_CONFIG_FILE ||
                       resolve(process.env.HOME || process.env.USERPROFILE || '.', '.alvasta/config.json');
    if (!existsSync(configPath)) {
      console.log('[gateway] no config file at ' + configPath + ' — no channels to start');
      return;
    }
    let config;
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[gateway] failed to read config:', e.message);
      return;
    }

    const channelsDir = resolve(__dirname, 'channels');
    const adapters = {
      telegram: join(channelsDir, 'telegram-adapter.js')
    };

    for (const [name, channelConfig] of Object.entries(config.channels || {})) {
      if (!channelConfig?.enabled) continue;
      const adapterScript = adapters[name];
      if (!adapterScript || !existsSync(adapterScript)) {
        console.log(`[gateway] no adapter for channel: ${name}`);
        continue;
      }
      this.spawnAdapter(name, adapterScript);
    }
  }

  spawnAdapter(name, scriptPath) {
    if (this.adapters.has(name)) return;
    console.log(`[gateway] starting ${name} adapter...`);
    const child = spawn('node', [scriptPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, ALVASTA_PORT: String(this.port), ALVASTA_HOST: this.host },
      windowsHide: true
    });
    child.on('exit', (code) => {
      console.log(`[gateway] ${name} adapter exited (code ${code})`);
      this.adapters.delete(name);
    });
    child.on('error', (err) => {
      console.error(`[gateway] ${name} adapter error:`, err.message);
      this.adapters.delete(name);
    });
    this.adapters.set(name, child);
  }

  stopChannels() {
    for (const [name, child] of this.adapters) {
      try { child.kill(); } catch {}
    }
    this.adapters.clear();
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
    this.stopChannels();
    this.manager.stopAll();
    if (this.wss) this.wss.close();
    if (this.http) this.http.close();
    this.store.close();
  }

  // ── HTTP handlers ──
  handleHttp(req, res) {
    // API endpoints
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(this.status(), null, 2));
    }
    if (req.url === '/api/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(this.store.listSessions(50), null, 2));
    }

    // Static files from /web
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = join(WEB_DIR, urlPath);

    // Prevent path traversal
    if (!filePath.startsWith(WEB_DIR)) {
      res.writeHead(403); return res.end('Forbidden');
    }

    if (existsSync(filePath)) {
      const ext = extname(filePath);
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      return res.end(readFileSync(filePath));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
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
