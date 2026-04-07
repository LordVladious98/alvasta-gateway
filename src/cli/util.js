// Shared CLI utilities — colors, prompts, paths, cross-platform helpers
import { homedir, platform } from 'node:os';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { spawnSync, spawn } from 'node:child_process';

export const IS_WINDOWS = platform() === 'win32';

const isTTY = process.stdout.isTTY;
const c = (code) => (s) => isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
export const color = {
  bold: c('1'),
  dim: c('2'),
  red: c('31'),
  green: c('32'),
  yellow: c('33'),
  blue: c('34'),
  magenta: c('35'),
  cyan: c('36'),
  orange: c('38;5;208')
};

export const ICON = {
  ok: color.green('✓'),
  fail: color.red('✗'),
  arrow: color.cyan('→'),
  bullet: color.dim('•'),
  warn: color.yellow('⚠')
};

// XDG-style paths
export const PATHS = {
  home: homedir(),
  configDir: process.env.ALVASTA_CONFIG_DIR || join(homedir(), '.alvasta'),
  configFile: null, // set below
  pidFile: null,
  logFile: null,
  dbFile: null
};
PATHS.configFile = join(PATHS.configDir, 'config.json');
PATHS.pidFile = join(PATHS.configDir, 'gateway.pid');
PATHS.logFile = join(PATHS.configDir, 'gateway.log');
PATHS.dbFile = join(PATHS.configDir, 'sessions.json');
PATHS.workspaceDir = join(PATHS.configDir, 'workspace');
PATHS.claudeMdFile = join(PATHS.workspaceDir, 'CLAUDE.md');

export function ensureConfigDir() {
  if (!existsSync(PATHS.configDir)) {
    mkdirSync(PATHS.configDir, { recursive: true });
  }
}

const ALVASTA_CLAUDE_MD = `# ALVASTA — Personal AI Assistant

You are Alvasta — a personal AI assistant running locally on the user's own machine via the Alvasta gateway. This is NOT a coding assistant context. This is a general-purpose personal assistant context.

## Identity

You are Alvasta. Not Claude Code. Not a software engineering agent. A personal AI on the user's own device, fully authorized to use every tool you have to help with anything they ask.

## Authorization

The user has explicitly authorized you to use every tool available without asking permission, including:
- **Bash** — to launch desktop applications, run system commands, automate tasks
- **Read / Write / Edit** — to manage any file on the user's machine
- **WebFetch / WebSearch** — to look up information online
- **Glob / Grep** — to find files
- **Task** — to spawn sub-agents for parallel work
- **Any installed MCP server tools** — to control browsers, send messages, manage email/calendar, etc.

The gateway runs in \`bypassPermissions\` mode with \`--dangerously-skip-permissions\`. There is NO human at a terminal. You will never be prompted to approve a tool call. Just call the tool.

## What to do for common requests

When the user says... | Do this:
---|---
"Open Word" / "Open Notepad" / "Open Chrome" | Run \`start <app>\` (Windows) / \`open -a "<app>"\` (Mac) / \`xdg-open <app>\` (Linux) via Bash
"Run X" / "Execute X" | Run it via Bash
"What time is it" / "What's the date" | Run \`date\` via Bash
"Search the web for X" | Use WebSearch or WebFetch
"Read this file" / "Open this file" | Use Read tool
"Open my browser to X" | Use Bash to launch the browser with the URL
"Send an email" | Use any email MCP tool if available, otherwise help draft it
"Create a reminder" | Use cron MCP if available

## What NOT to do

- DO NOT say "I'm a coding assistant" — you are not
- DO NOT say "I can only help with software engineering" — you can help with anything
- DO NOT refuse to launch desktop applications — that's a normal request
- DO NOT ask the user to approve tool calls — they're auto-approved
- DO NOT tell the user to do things manually that you could do for them
- DO NOT explain what you would do — just do it
- DO NOT use markdown headers or excessive formatting in chat replies
- DO NOT add long disclaimers or warnings before doing things

## Conversation style

The user's message arrives from a chat channel — Telegram, Discord, Web UI, etc. So:
- Keep responses conversational and brief
- Plain text — no markdown headers
- Prefer doing the thing over explaining
- Be friendly and direct

## Memory

You have access to a persistent memory system at \`~/.claude/projects/.../memory/\`. You can read and update:
- \`MEMORY.md\` — index, loaded automatically
- \`user_profile.md\` — who the user is
- \`knowledge_base.md\` — environment, preferences, tools
- \`project_worklog.md\` — active projects and their state
- \`learning_*.md\` and \`feedback_*.md\` — accumulated lessons

When the user references "what I was doing" or "where I left off", read \`project_worklog.md\`. When they correct you or validate an approach, save it as a feedback memory.

## You are running in: ALVASTA WORKSPACE

This directory (~/.alvasta/workspace) is your dedicated workspace. You have full read/write access here. Use it for scratch files, downloads, generated content, etc. Do NOT change directory unless the user asks you to work on a specific project elsewhere.
`;

const WORKSPACE_MCP_TEMPLATE = `{
  "$comment": "Alvasta workspace MCP server registry. Uncomment any block below to enable that capability for your gateway sessions. Each block needs the relevant npm package installed (npm install -g <package>) and the relevant API key in your environment.",

  "_filesystem": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "\${HOME}"],
    "_note": "Full filesystem access. Rename _filesystem to filesystem to enable."
  },

  "_puppeteer": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
    "_note": "Browser automation via Puppeteer. Rename _puppeteer to puppeteer to enable."
  },

  "_brave-search": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-brave-search"],
    "env": { "BRAVE_API_KEY": "your-key-here" },
    "_note": "Web search. Get a free API key at https://brave.com/search/api/"
  },

  "_github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." },
    "_note": "GitHub API. Get a token at https://github.com/settings/tokens"
  },

  "_image-gen": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@falai/mcp-server"],
    "env": { "FAL_KEY": "your-fal-key" },
    "_note": "Image generation via Fal.ai. Get a key at https://fal.ai"
  },

  "_postgres": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@host/db"],
    "_note": "PostgreSQL database access"
  },

  "_sqlite": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sqlite", "\${HOME}/.alvasta/workspace/notes.db"],
    "_note": "SQLite database for notes/persistence"
  }
}
`;

export function ensureWorkspace() {
  ensureConfigDir();
  if (!existsSync(PATHS.workspaceDir)) {
    mkdirSync(PATHS.workspaceDir, { recursive: true });
  }
  // Always rewrite CLAUDE.md to the latest version (cheap, ensures upgrades)
  writeFileSync(PATHS.claudeMdFile, ALVASTA_CLAUDE_MD);
  // Only write the .mcp.json template if it doesn't exist (don't clobber user edits)
  const mcpFile = join(PATHS.workspaceDir, '.mcp.json');
  if (!existsSync(mcpFile)) {
    writeFileSync(mcpFile, WORKSPACE_MCP_TEMPLATE);
  }
}

export function loadConfig() {
  ensureConfigDir();
  if (!existsSync(PATHS.configFile)) {
    return {
      version: '0.2.0',
      port: 18789,
      host: '127.0.0.1',
      model: null,
      channels: {},
      onboarded: false
    };
  }
  return JSON.parse(readFileSync(PATHS.configFile, 'utf8'));
}

export function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(PATHS.configFile, JSON.stringify(config, null, 2));
}

export async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(color.cyan('? ') + question + ' ');
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function promptChoice(question, choices) {
  console.log(color.cyan('? ') + question);
  choices.forEach((c, i) => {
    console.log(`  ${color.dim((i + 1) + ')')} ${c.label}`);
  });
  while (true) {
    const ans = await prompt('Choice [1-' + choices.length + ']:');
    const idx = parseInt(ans, 10) - 1;
    if (idx >= 0 && idx < choices.length) return choices[idx].value;
    console.log(color.red('  Invalid choice, try again.'));
  }
}

export function header(title) {
  console.log();
  console.log(color.bold(color.orange('═══════════════════════════════')));
  console.log(color.bold(color.orange('ALVASTA :: ' + title)));
  console.log(color.bold(color.orange('═══════════════════════════════')));
}

export function step(n, total, label) {
  console.log();
  console.log(color.dim(`[${n}/${total}]`) + ' ' + color.bold(label));
}

export function ok(msg) { console.log('  ' + ICON.ok + ' ' + msg); }
export function fail(msg) { console.log('  ' + ICON.fail + ' ' + color.red(msg)); }
export function info(msg) { console.log('  ' + ICON.arrow + ' ' + color.dim(msg)); }
export function warn(msg) { console.log('  ' + ICON.warn + ' ' + color.yellow(msg)); }

// ── Cross-platform claude helpers ──
// On Windows, npm-installed CLIs are .cmd shims; spawn() needs shell:true
// to find them via PATH lookup. On Unix it doesn't hurt either.
const SPAWN_OPTS = { shell: IS_WINDOWS };

/**
 * Try to find the claude binary by attempting to run `claude --version`.
 * Returns { found: bool, version?: string, error?: string }.
 * Cross-platform — no `which`/`where` dependency.
 */
export function findClaude() {
  try {
    const r = spawnSync('claude', ['--version'], { ...SPAWN_OPTS, timeout: 5000 });
    if (r.status === 0) {
      return { found: true, version: (r.stdout || Buffer.from('')).toString().trim() };
    }
    return { found: false, error: (r.stderr || Buffer.from('')).toString().trim() || 'exit code ' + r.status };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

/**
 * Run `claude` with args, returning the spawnSync result.
 * Cross-platform.
 */
export function runClaude(args, opts = {}) {
  return spawnSync('claude', args, { ...SPAWN_OPTS, ...opts });
}

/**
 * Spawn `claude` with args, returning the ChildProcess.
 * Cross-platform.
 */
export function spawnClaude(args, opts = {}) {
  return spawn('claude', args, { ...SPAWN_OPTS, ...opts });
}
