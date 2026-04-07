// Per-session Claude Code agent runner
// Spawns and manages a long-running `claude` child process per session.
// Communicates via stream-json input/output for realtime bidirectional flow.
//
// Each session = one persistent claude process. Multiple sessions = multiple
// processes running concurrently. No queuing.

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { platform } from 'node:os';

const IS_WINDOWS = platform() === 'win32';

export class AgentRunner extends EventEmitter {
  constructor({ sessionId, claudeSessionId, workingDir, options = {} }) {
    super();
    this.sessionId = sessionId;
    this.claudeSessionId = claudeSessionId; // null on first run, set after first response
    this.workingDir = workingDir;
    this.options = options;
    this.proc = null;
    this.lineBuffer = '';
    this.ready = false;
    this.busy = false;
  }

  start() {
    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose', // required by Claude Code when using stream-json output
      '--include-partial-messages',
      '--permission-mode', this.options.permissionMode || 'bypassPermissions',
      '--dangerously-skip-permissions' // gateway sessions are non-interactive; never prompt
    ];

    if (this.claudeSessionId) {
      args.push('--resume', this.claudeSessionId);
    }

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    if (this.options.systemPromptAppend) {
      args.push('--append-system-prompt', this.options.systemPromptAppend);
    }

    this.proc = spawn('claude', args, {
      cwd: this.workingDir,
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WINDOWS, // Windows needs shell:true to find .cmd shims
      windowsHide: true
    });

    this.proc.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.proc.stderr.on('data', (chunk) => {
      this.emit('stderr', chunk.toString());
    });
    this.proc.on('exit', (code, signal) => {
      this.ready = false;
      this.emit('exit', { code, signal });
    });
    this.proc.on('error', (err) => {
      this.emit('error', err);
    });

    this.ready = true;
    this.emit('ready');
  }

  handleStdout(chunk) {
    this.lineBuffer += chunk.toString();
    let newlineIdx;
    while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.slice(0, newlineIdx).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const event = JSON.parse(line);
        this.handleEvent(event);
      } catch (e) {
        this.emit('parse-error', { line, error: e.message });
      }
    }
  }

  handleEvent(event) {
    // Capture session_id from system messages
    if (event.type === 'system' && event.session_id) {
      this.claudeSessionId = event.session_id;
      this.emit('session-id', event.session_id);
    }

    // Final result message
    if (event.type === 'result') {
      this.busy = false;
      this.emit('done', event);
      return;
    }

    // Forward all events to listeners
    this.emit('event', event);

    // Convenience: extract assistant text deltas
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          this.emit('text', block.text);
        }
      }
    }
  }

  send(message) {
    if (!this.proc || !this.ready) {
      throw new Error('Agent not ready');
    }
    if (this.busy) {
      throw new Error('Agent is busy with previous message');
    }
    this.busy = true;

    const userMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: typeof message === 'string'
          ? [{ type: 'text', text: message }]
          : message
      }
    };

    this.proc.stdin.write(JSON.stringify(userMessage) + '\n');
  }

  stop() {
    if (this.proc) {
      this.proc.stdin.end();
      // Give it a chance to exit gracefully
      setTimeout(() => {
        if (this.proc && !this.proc.killed) {
          this.proc.kill('SIGTERM');
        }
      }, 2000);
    }
    this.ready = false;
  }
}
