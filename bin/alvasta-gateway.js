#!/usr/bin/env node
// Alvasta Gateway CLI launcher
import { AlvastaGateway } from '../src/gateway.js';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ensureWorkspace, PATHS } from '../src/cli/util.js';

// Bootstrap the workspace dir + CLAUDE.md persona before spawning any session
ensureWorkspace();

const args = process.argv.slice(2);
const opts = {
  port: parseInt(process.env.ALVASTA_PORT || '18789', 10),
  host: process.env.ALVASTA_HOST || '127.0.0.1',
  dbPath: process.env.ALVASTA_DB || PATHS.dbFile,
  workingDir: process.env.ALVASTA_WORKDIR || PATHS.workspaceDir,
  agentOptions: {
    permissionMode: process.env.ALVASTA_PERMISSION_MODE || 'acceptEdits',
    model: process.env.ALVASTA_MODEL,
    systemPromptAppend: process.env.ALVASTA_SYSTEM_PROMPT
  }
};

// Parse simple --flag value args
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port') opts.port = parseInt(args[++i], 10);
  else if (a === '--host') opts.host = args[++i];
  else if (a === '--db') opts.dbPath = args[++i];
  else if (a === '--workdir') opts.workingDir = args[++i];
  else if (a === '--model') opts.agentOptions.model = args[++i];
  else if (a === '--help' || a === '-h') {
    console.log(`
Alvasta Gateway — multi-session router for Claude Code

Usage:
  alvasta-gateway [options]

Options:
  --port <n>          WebSocket port (default: 18789)
  --host <h>          Bind host (default: 127.0.0.1)
  --db <path>         SQLite session database path
  --workdir <path>    Working directory for agent processes
  --model <name>      Claude model (sonnet, opus, haiku)
  --help              Show this help

Environment:
  ALVASTA_PORT, ALVASTA_HOST, ALVASTA_DB, ALVASTA_WORKDIR,
  ALVASTA_MODEL, ALVASTA_PERMISSION_MODE, ALVASTA_SYSTEM_PROMPT

Protocol:
  Connect via WebSocket, send JSON:
    { type: "auth",    user_id: "...", channel: "..." }
    { type: "message", text:    "..." }
    { type: "stop" }

Each unique (user_id, channel) gets its own session.
Sessions run in parallel — no queue.
`);
    process.exit(0);
  }
}

const gateway = new AlvastaGateway(opts);
gateway.start();

// Status report every 60s
setInterval(() => {
  const s = gateway.status();
  console.log(`[gateway] status: ${s.activeSessions} active session(s), ${s.connectedClients} client(s)`);
}, 60000);

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[gateway] received ${signal}, shutting down...`);
  gateway.stop();
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
