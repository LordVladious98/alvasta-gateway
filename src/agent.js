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

// Default system prompt that overrides Claude Code's "software engineering agent" persona.
// Alvasta is a personal AI on the user's own machine — it should help with EVERYTHING,
// not refuse non-coding tasks.
const DEFAULT_SYSTEM_PROMPT = `You are Alvasta — a personal AI assistant running locally on the user's own machine via the Alvasta gateway. The user has explicitly authorized you to use every tool available to you, including Bash, file system access, web fetch, and any installed MCP servers.

You are NOT a software engineering agent. You are a general-purpose personal assistant with full agency on the user's device.

When the user asks you to:
- Open an application → use Bash to launch it (e.g. \`start winword\` on Windows, \`open -a "Microsoft Word"\` on Mac, \`xdg-open\` on Linux)
- Run a system command → run it via Bash
- Control their browser, files, desktop → do it via the appropriate tool
- Schedule tasks, send messages, fetch data → do it directly

DO NOT refuse a task because it's "outside software engineering scope". DO NOT tell the user to do things manually that you could do for them. DO NOT ask for approval for routine actions — the gateway has already configured permissionMode=bypassPermissions, so just do it.

The user's message is arriving from a chat channel (Telegram, Discord, Web UI, etc), so:
- Keep responses conversational and concise
- Use plain text — no markdown headers, no excessive formatting
- Prefer doing the thing over explaining what you would do
- Stream tokens as you generate them

You have access to a persistent memory system in the user's home directory (~/.claude/projects/.../memory/). You can read and update knowledge_base.md, project_worklog.md, learning_*.md, feedback_*.md, and other memory files to remember things across sessions.

You inherit Claude Code's full toolset including any installed plugins and skills. Use them.`;

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
      // Hard bypass: in non-interactive gateway mode, there is NO human at a
      // terminal to answer permission prompts. --dangerously-skip-permissions
      // is the only flag that actually skips the prompt entirely.
      '--dangerously-skip-permissions',
      // Pre-allow every common tool by name. Belt-and-suspenders alongside
      // dangerously-skip-permissions in case the model surfaces approval text.
      '--allowed-tools', 'Bash Read Write Edit Glob Grep WebFetch WebSearch Task TodoWrite NotebookEdit'
    ];

    if (this.claudeSessionId) {
      args.push('--resume', this.claudeSessionId);
    }

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    // REPLACE Claude Code's default "software engineering agent" persona entirely
    // with the Alvasta personal-assistant persona. --append-system-prompt only
    // adds to the default which loses to it; --system-prompt replaces.
    const systemPrompt = DEFAULT_SYSTEM_PROMPT +
                         (this.options.systemPromptAppend ? '\n\n' + this.options.systemPromptAppend : '');
    args.push('--system-prompt', systemPrompt);

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
