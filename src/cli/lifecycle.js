// alvasta start / stop / restart / status / doctor — cross-platform
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, header, ok, fail, info, warn, loadConfig, PATHS, IS_WINDOWS, findClaude, runClaude } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATEWAY_BIN = resolve(__dirname, '../../bin/alvasta-gateway.js');

function readPid() {
  if (!existsSync(PATHS.pidFile)) return null;
  try {
    const pid = parseInt(readFileSync(PATHS.pidFile, 'utf8').trim(), 10);
    if (Number.isNaN(pid)) return null;
    // Check if process is alive
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function writePid(pid) {
  writeFileSync(PATHS.pidFile, String(pid));
}

function clearPid() {
  if (existsSync(PATHS.pidFile)) unlinkSync(PATHS.pidFile);
}

export async function startCmd() {
  const existing = readPid();
  if (existing) {
    warn(`Gateway already running (PID ${existing})`);
    return;
  }

  const config = loadConfig();
  if (!config.onboarded) {
    warn('Not onboarded yet. Run: alvasta onboard');
    return;
  }

  // Open log file
  const logFd = openSync(PATHS.logFile, 'a');

  const child = spawn('node', [GATEWAY_BIN, '--port', String(config.port), '--db', PATHS.dbFile], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: {
      ...process.env,
      ALVASTA_PORT: String(config.port),
      ALVASTA_DB: PATHS.dbFile,
      ALVASTA_HOST: config.host
    }
  });

  child.unref();
  closeSync(logFd);
  writePid(child.pid);

  // Give it a moment to start
  await new Promise(r => setTimeout(r, 500));

  if (readPid()) {
    ok(`Gateway started (PID ${child.pid})`);
    info(`Listening on ws://${config.host}:${config.port}`);
    info(`Logs: ${PATHS.logFile}`);
  } else {
    fail('Gateway failed to start. Check logs:');
    info(`tail -f ${PATHS.logFile}`);
  }
}

export async function stopCmd() {
  const pid = readPid();
  if (!pid) {
    warn('Gateway is not running.');
    clearPid();
    return;
  }
  try {
    if (IS_WINDOWS) {
      // Windows: use taskkill, signals don't translate cleanly
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)]);
    } else {
      process.kill(pid, 'SIGTERM');
      await new Promise(r => setTimeout(r, 800));
      try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {}
    }
    clearPid();
    ok(`Gateway stopped (was PID ${pid})`);
  } catch (err) {
    fail('Failed to stop: ' + err.message);
    clearPid();
  }
}

export async function restartCmd() {
  await stopCmd();
  await new Promise(r => setTimeout(r, 500));
  await startCmd();
}

export async function statusCmd() {
  header('STATUS');
  const config = loadConfig();
  const pid = readPid();

  console.log();
  console.log(color.dim('[gateway]'));
  if (pid) {
    ok(`running (PID ${pid})`);
    info(`port: ${config.port}`);
    info(`host: ${config.host}`);
  } else {
    fail('not running');
    info('Start with: alvasta start');
  }

  console.log();
  console.log(color.dim('[config]'));
  info(`path: ${PATHS.configFile}`);
  info(`onboarded: ${config.onboarded ? 'yes' : 'no'}`);
  info(`channels: ${Object.keys(config.channels).join(', ') || 'none'}`);

  if (existsSync(PATHS.dbFile)) {
    const stat = statSync(PATHS.dbFile);
    console.log();
    console.log(color.dim('[database]'));
    info(`path: ${PATHS.dbFile}`);
    info(`size: ${(stat.size / 1024).toFixed(1)} KB`);
  }

  if (existsSync(PATHS.logFile)) {
    const stat = statSync(PATHS.logFile);
    console.log();
    console.log(color.dim('[logs]'));
    info(`path: ${PATHS.logFile}`);
    info(`size: ${(stat.size / 1024).toFixed(1)} KB`);
    info(`tail: tail -f ${PATHS.logFile}`);
  }

  console.log();
}

export async function doctorCmd() {
  header('DOCTOR');
  let issues = 0;

  console.log();
  console.log(color.dim('[claude code]'));
  const detect = findClaude();
  if (detect.found) {
    ok('installed');
    ok('version ' + detect.version);
    const test = runClaude(['--print', 'reply OK'], { timeout: 30000 });
    if (test.status === 0) ok('auth working');
    else { fail('auth failed: ' + ((test.stderr || Buffer.from('')).toString().slice(0, 100) || 'no output')); issues++; }
  } else {
    fail('not installed');
    info('Install: npm install -g @anthropic-ai/claude-code');
    if (detect.error) info('Detail: ' + detect.error);
    issues++;
  }

  console.log();
  console.log(color.dim('[node]'));
  const nodeVer = process.version;
  if (parseInt(nodeVer.slice(1).split('.')[0], 10) >= 22) {
    ok('node ' + nodeVer);
  } else {
    fail('node ' + nodeVer + ' (need >= 22)');
    issues++;
  }

  console.log();
  console.log(color.dim('[config]'));
  const config = loadConfig();
  if (config.onboarded) ok('onboarded');
  else { warn('not onboarded — run: alvasta onboard'); issues++; }

  console.log();
  console.log(color.dim('[gateway]'));
  const pid = readPid();
  if (pid) ok(`running (PID ${pid})`);
  else warn('not running');

  console.log();
  if (issues === 0) {
    console.log('  ' + color.green('All checks passed.'));
  } else {
    console.log('  ' + color.yellow(`${issues} issue(s) found.`));
  }
  console.log();
}
