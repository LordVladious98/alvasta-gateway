// Smoke test — proves the multi-session no-queue claim.
//
// 1. Spin up gateway on a test port
// 2. Connect 3 clients simulating 3 different users
// 3. All 3 send a message at the same instant
// 4. Verify all 3 get session IDs back without serialization
// 5. Verify each session is independent
//
// Note: this test requires `claude` to be on PATH and authenticated.

import { AlvastaGateway } from '../src/gateway.js';
import { WebSocket } from 'ws';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 28789;
const dbPath = join(tmpdir(), `alvasta-test-${Date.now()}.db`);

const gateway = new AlvastaGateway({
  port: PORT,
  dbPath,
  workingDir: process.cwd(),
  agentOptions: { permissionMode: 'bypassPermissions' }
});

gateway.start();

// Wait for the server to be ready
await new Promise(r => setTimeout(r, 500));

const users = [
  { id: 'alice', channel: 'test', message: 'reply with the single word ALICE' },
  { id: 'bob',   channel: 'test', message: 'reply with the single word BOB' },
  { id: 'carol', channel: 'test', message: 'reply with the single word CAROL' }
];

const results = await Promise.all(users.map(async (u) => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const start = Date.now();
    let sessionId = null;
    let textCollected = '';
    let firstTokenAt = null;
    let timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`${u.id}: timeout`));
    }, 90000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        user_id: u.id,
        channel: u.channel
      }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'session') {
        sessionId = msg.session_id;
        ws.send(JSON.stringify({ type: 'message', text: u.message }));
      } else if (msg.type === 'text') {
        if (!firstTokenAt) firstTokenAt = Date.now();
        textCollected += msg.delta;
      } else if (msg.type === 'done') {
        clearTimeout(timeout);
        ws.close();
        resolve({
          user: u.id,
          sessionId,
          text: textCollected.trim(),
          totalMs: Date.now() - start,
          firstTokenMs: firstTokenAt - start
        });
      } else if (msg.type === 'error') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`${u.id}: ${msg.error}`));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`${u.id}: ${err.message}`));
    });
  });
}));

console.log('\n═══════════════════════');
console.log('SMOKE TEST RESULTS');
console.log('═══════════════════════');
results.forEach(r => {
  console.log(`${r.user.padEnd(8)} :: session=${r.sessionId.slice(0, 24)}... :: ${r.totalMs}ms total :: first token at ${r.firstTokenMs}ms`);
  console.log(`           text: ${r.text.slice(0, 80)}`);
});

// Verify each session is unique
const sessions = new Set(results.map(r => r.sessionId));
console.log(`\nUnique sessions: ${sessions.size} of ${results.length} (expected: ${results.length})`);

// Verify approximately concurrent (first tokens should be within a few seconds of each other)
const firstTokens = results.map(r => r.firstTokenMs).sort((a, b) => a - b);
const spread = firstTokens[firstTokens.length - 1] - firstTokens[0];
console.log(`First-token spread: ${spread}ms (lower = more concurrent)`);

const ok = sessions.size === results.length && spread < 5000;
console.log(`\n${ok ? '✓ PASS' : '✗ FAIL'}: Multi-session ${ok ? 'works concurrently' : 'is not concurrent'}\n`);

gateway.stop();
process.exit(ok ? 0 : 1);
