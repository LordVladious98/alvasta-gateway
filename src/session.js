// Session manager — orchestrates agent runners per session.
// Each unique (user_id, channel) gets its own session and its own AgentRunner.
// All sessions run concurrently in the same Node process.

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { AgentRunner } from './agent.js';

export class SessionManager extends EventEmitter {
  constructor({ store, workingDir, agentOptions = {} }) {
    super();
    this.store = store;
    this.workingDir = workingDir;
    this.agentOptions = agentOptions;
    this.runners = new Map(); // sessionId -> AgentRunner
  }

  async getOrCreate(userId, channel, metadata = {}) {
    // Look up existing
    let session = this.store.findSession(userId, channel);
    if (!session) {
      const id = `${channel}-${userId}-${randomUUID().slice(0, 8)}`;
      session = this.store.createSession({ id, userId, channel, metadata });
      this.emit('session-created', session);
    }

    // Spawn runner if not already running
    if (!this.runners.has(session.id)) {
      this.spawnRunner(session);
    }

    return session;
  }

  spawnRunner(session) {
    const runner = new AgentRunner({
      sessionId: session.id,
      claudeSessionId: session.claude_session_id,
      workingDir: this.workingDir,
      options: this.agentOptions
    });

    runner.on('session-id', (claudeSessionId) => {
      this.store.setClaudeSessionId(session.id, claudeSessionId);
    });

    runner.on('text', (text) => {
      this.emit('text', { sessionId: session.id, text });
    });

    runner.on('event', (event) => {
      this.emit('event', { sessionId: session.id, event });
    });

    runner.on('done', (result) => {
      this.store.bumpActivity(session.id);
      this.emit('done', { sessionId: session.id, result });
    });

    runner.on('exit', () => {
      this.runners.delete(session.id);
      this.emit('runner-exit', { sessionId: session.id });
    });

    runner.on('error', (err) => {
      this.emit('runner-error', { sessionId: session.id, error: err.message });
    });

    runner.start();
    this.runners.set(session.id, runner);
    return runner;
  }

  send(sessionId, message) {
    let runner = this.runners.get(sessionId);
    if (!runner) {
      // Runner might have exited between messages (claude child crashed,
      // session aged out, etc). Try to respawn from the persisted session.
      const session = this.store.getSession(sessionId);
      if (!session) {
        throw new Error(`No session ${sessionId}`);
      }
      console.log(`[session] runner missing for ${sessionId}, respawning...`);
      runner = this.spawnRunner(session);
    }
    this.store.addMessage(sessionId, 'user', JSON.stringify(message));
    runner.send(message);
  }

  stop(sessionId) {
    const runner = this.runners.get(sessionId);
    if (runner) {
      runner.stop();
      this.runners.delete(sessionId);
    }
  }

  stopAll() {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
    this.runners.clear();
  }

  getActiveCount() {
    return this.runners.size;
  }

  getActiveSessionIds() {
    return Array.from(this.runners.keys());
  }
}
