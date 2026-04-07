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

export function ensureConfigDir() {
  if (!existsSync(PATHS.configDir)) {
    mkdirSync(PATHS.configDir, { recursive: true });
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
