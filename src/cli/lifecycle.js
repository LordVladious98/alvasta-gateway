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
  let warnings = 0;
  const inc = (level) => level === 'fail' ? issues++ : warnings++;

  // ─── Claude Code ───
  console.log();
  console.log(color.dim('[claude code]'));
  const detect = findClaude();
  if (detect.found) {
    ok('installed');
    ok('version ' + detect.version);
    const test = runClaude(['--print', 'reply OK'], { timeout: 30000 });
    if (test.status === 0) ok('auth working');
    else { fail('auth failed: ' + ((test.stderr || Buffer.from('')).toString().slice(0, 100) || 'no output')); inc('fail'); }
  } else {
    fail('not installed');
    info('Install: npm install -g @anthropic-ai/claude-code');
    if (detect.error) info('Detail: ' + detect.error);
    inc('fail');
  }

  // ─── Node ───
  console.log();
  console.log(color.dim('[node]'));
  const nodeVer = process.version;
  if (parseInt(nodeVer.slice(1).split('.')[0], 10) >= 22) {
    ok('node ' + nodeVer);
  } else {
    fail('node ' + nodeVer + ' (need >= 22)');
    inc('fail');
  }

  // ─── Git ───
  console.log();
  console.log(color.dim('[git]'));
  const git = spawnSync('git', ['--version'], { encoding: 'utf8', shell: IS_WINDOWS });
  if (git.status === 0) ok(git.stdout.trim());
  else { warn('git not installed (alvasta upgrade requires it)'); inc('warn'); }

  // ─── Config + workspace ───
  console.log();
  console.log(color.dim('[config]'));
  const config = loadConfig();
  if (config.onboarded) ok('onboarded');
  else { warn('not onboarded — run: alvasta onboard'); inc('warn'); }
  info('config: ' + PATHS.configFile);
  info('workspace: ' + PATHS.workspaceDir);
  if (existsSync(PATHS.claudeMdFile)) ok('CLAUDE.md persona present');
  else { warn('CLAUDE.md missing — run alvasta start to recreate'); inc('warn'); }

  // ─── Channels ───
  console.log();
  console.log(color.dim('[channels]'));
  const channels = Object.entries(config.channels || {});
  if (!channels.length) {
    warn('no channels configured');
    inc('warn');
  } else {
    for (const [name, c] of channels) {
      if (c.enabled) ok(`${name}: enabled`);
      else info(`${name}: disabled`);
    }
  }

  // ─── Gateway ───
  console.log();
  console.log(color.dim('[gateway]'));
  const pid = readPid();
  if (pid) {
    ok(`running (PID ${pid})`);
    info('port: ' + (config.port || 18789));
  } else {
    warn('not running');
    inc('warn');
  }

  // ─── Database ───
  console.log();
  console.log(color.dim('[database]'));
  if (existsSync(PATHS.dbFile)) {
    const stat = statSync(PATHS.dbFile);
    ok('sessions store: ' + (stat.size / 1024).toFixed(1) + ' KB');
  } else {
    info('sessions store: not yet created');
  }

  // ─── Logs ───
  console.log();
  console.log(color.dim('[logs]'));
  if (existsSync(PATHS.logFile)) {
    const stat = statSync(PATHS.logFile);
    info('gateway.log: ' + (stat.size / 1024).toFixed(1) + ' KB');
    if (stat.size > 10 * 1024 * 1024) {
      warn('log file > 10MB, consider rotating'); inc('warn');
    }
  }

  // ─── Memory ───
  console.log();
  console.log(color.dim('[memory]'));
  const claudeProjects = resolve(PATHS.home, '.claude/projects');
  if (existsSync(claudeProjects)) {
    ok('claude projects dir present');
  } else {
    warn('no ~/.claude/projects (memory needs Claude Code to have run at least once)');
    inc('warn');
  }

  // ─── Network ───
  console.log();
  console.log(color.dim('[network]'));
  // Quick TCP check on the configured port
  const port = config.port || 18789;
  const portCheck = spawnSync(IS_WINDOWS ? 'powershell' : 'bash', IS_WINDOWS
    ? ['-Command', `Test-NetConnection -ComputerName 127.0.0.1 -Port ${port} -InformationLevel Quiet`]
    : ['-c', `(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null && echo OK`], { encoding: 'utf8' });
  if (portCheck.stdout?.includes('True') || portCheck.stdout?.includes('OK')) {
    ok(`port ${port} reachable`);
  } else if (pid) {
    warn(`port ${port} not reachable (gateway PID ${pid} but socket not listening?)`); inc('warn');
  } else {
    info(`port ${port} not in use (gateway not running)`);
  }

  // Check internet connectivity for Anthropic API
  const inetCheck = spawnSync(IS_WINDOWS ? 'powershell' : 'bash', IS_WINDOWS
    ? ['-Command', 'Test-NetConnection api.anthropic.com -Port 443 -InformationLevel Quiet']
    : ['-c', '(echo > /dev/tcp/api.anthropic.com/443) 2>/dev/null && echo OK'], { encoding: 'utf8', timeout: 5000 });
  if (inetCheck.stdout?.includes('True') || inetCheck.stdout?.includes('OK')) {
    ok('api.anthropic.com:443 reachable');
  } else {
    warn('api.anthropic.com unreachable — Claude API will fail'); inc('warn');
  }

  // ─── MCP servers ───
  console.log();
  console.log(color.dim('[mcp servers]'));
  const mcpFile = resolve(PATHS.workspaceDir, '.mcp.json');
  if (existsSync(mcpFile)) {
    let mcpData = {};
    try {
      mcpData = JSON.parse(readFileSync(mcpFile, 'utf8'));
      const enabled = Object.keys(mcpData).filter(k => !k.startsWith('_') && !k.startsWith('$'));
      const disabled = Object.keys(mcpData).filter(k => k.startsWith('_'));
      ok(`${enabled.length} enabled, ${disabled.length} disabled`);
      if (enabled.length) {
        info('enabled: ' + enabled.join(', '));
      }
      // Validate enabled servers have required env vars
      for (const name of enabled) {
        const def = mcpData[name];
        if (def.env) {
          for (const [k, v] of Object.entries(def.env)) {
            if (typeof v === 'string' && (v.includes('your-') || v.includes('-here') || v === '')) {
              warn(`${name}: env ${k} looks unset (placeholder value)`); inc('warn');
            }
          }
        }
      }
    } catch (e) {
      fail('invalid .mcp.json: ' + e.message); inc('fail');
    }
  } else {
    info('no .mcp.json (will be created on next gateway start)');
  }

  // ─── Disk space ───
  console.log();
  console.log(color.dim('[disk]'));
  try {
    const dfCmd = IS_WINDOWS
      ? spawnSync('powershell', ['-Command', `(Get-PSDrive ${PATHS.home.charAt(0)}).Free`], { encoding: 'utf8' })
      : spawnSync('df', ['-h', PATHS.home], { encoding: 'utf8' });
    if (dfCmd.status === 0) {
      const out = dfCmd.stdout.trim();
      if (IS_WINDOWS) {
        const freeBytes = parseInt(out, 10);
        const freeGb = (freeBytes / 1e9).toFixed(1);
        if (freeBytes < 1e9) {
          fail(`free space: ${freeGb} GB (low!)`); inc('fail');
        } else {
          ok(`free space: ${freeGb} GB`);
        }
      } else {
        // Skip parsing df, just print the relevant line
        const lines = out.split('\n');
        if (lines.length > 1) info(lines[lines.length - 1].trim());
        ok('disk check ran');
      }
    }
  } catch {}

  // ─── Permissions ───
  console.log();
  console.log(color.dim('[permissions]'));
  // Verify we can write to the config dir
  try {
    const testFile = resolve(PATHS.configDir, '.write-test');
    writeFileSync(testFile, 'ok');
    unlinkSync(testFile);
    ok('config dir writable');
  } catch (e) {
    fail('config dir not writable: ' + e.message); inc('fail');
  }
  // Verify we can write to the workspace dir
  try {
    const testFile = resolve(PATHS.workspaceDir, '.write-test');
    writeFileSync(testFile, 'ok');
    unlinkSync(testFile);
    ok('workspace dir writable');
  } catch (e) {
    warn('workspace dir not writable: ' + e.message); inc('warn');
  }

  // ─── Auto-start daemon ───
  console.log();
  console.log(color.dim('[autostart]'));
  let autostartFound = false;
  if (IS_WINDOWS) {
    const sched = spawnSync('schtasks', ['/Query', '/TN', 'AlvastaGateway'], { encoding: 'utf8' });
    if (sched.status === 0) { ok('Task Scheduler entry: AlvastaGateway'); autostartFound = true; }
  } else if (process.platform === 'darwin') {
    const launchd = resolve(PATHS.home, 'Library/LaunchAgents/au.com.alvasta.gateway.plist');
    if (existsSync(launchd)) { ok('LaunchAgent: ' + launchd); autostartFound = true; }
  } else {
    const systemd = resolve(PATHS.home, '.config/systemd/user/alvasta-gateway.service');
    if (existsSync(systemd)) { ok('systemd unit: ' + systemd); autostartFound = true; }
  }
  if (!autostartFound) {
    info('not configured for auto-start (run: alvasta daemon install)');
  }

  // ─── Summary ───
  console.log();
  if (issues === 0 && warnings === 0) {
    console.log('  ' + color.green('All checks passed.'));
  } else if (issues === 0) {
    console.log('  ' + color.yellow(`${warnings} warning(s).`));
  } else {
    console.log('  ' + color.red(`${issues} issue(s)`) + ', ' + color.yellow(`${warnings} warning(s).`));
  }
  console.log();
}
