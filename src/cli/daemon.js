// alvasta daemon install / uninstall / status
//
// Cross-platform service installer that auto-starts the gateway on boot.
// - Linux:   systemd user unit
// - macOS:   launchd LaunchAgent
// - Windows: Task Scheduler entry that runs at logon
//
// Idempotent — safe to re-run.

import { spawnSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { color, header, ok, fail, info, warn, IS_WINDOWS, PATHS } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '../..');
const GATEWAY_BIN = resolve(PKG_ROOT, 'bin/alvasta-gateway.js');

export async function daemonCmd(args) {
  const sub = args[0] || 'status';
  switch (sub) {
    case 'install':   return installDaemon();
    case 'uninstall': return uninstallDaemon();
    case 'status':    return statusDaemon();
    default:
      console.log('Usage: alvasta daemon <install|uninstall|status>');
      console.log('  alvasta daemon install   # auto-start gateway on login/boot');
      console.log('  alvasta daemon uninstall # remove auto-start');
      console.log('  alvasta daemon status    # is auto-start configured?');
  }
}

function installDaemon() {
  header('DAEMON INSTALL');
  console.log();
  const os = platform();
  if (os === 'linux') return installSystemd();
  if (os === 'darwin') return installLaunchd();
  if (os === 'win32') return installTaskScheduler();
  fail('Unsupported platform: ' + os);
}

function uninstallDaemon() {
  header('DAEMON UNINSTALL');
  console.log();
  const os = platform();
  if (os === 'linux') return uninstallSystemd();
  if (os === 'darwin') return uninstallLaunchd();
  if (os === 'win32') return uninstallTaskScheduler();
  fail('Unsupported platform: ' + os);
}

function statusDaemon() {
  header('DAEMON STATUS');
  console.log();
  const os = platform();
  if (os === 'linux') return statusSystemd();
  if (os === 'darwin') return statusLaunchd();
  if (os === 'win32') return statusTaskScheduler();
}

// ─── Linux: systemd user unit ───────────────────────────

const SYSTEMD_DIR = join(homedir(), '.config/systemd/user');
const SYSTEMD_UNIT_NAME = 'alvasta-gateway.service';
const SYSTEMD_UNIT_PATH = join(SYSTEMD_DIR, SYSTEMD_UNIT_NAME);

function installSystemd() {
  const node = process.execPath;
  const unit = `[Unit]
Description=Alvasta Gateway — personal AI multi-session router
After=network.target

[Service]
Type=simple
ExecStart=${node} ${GATEWAY_BIN}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

  mkdirSync(SYSTEMD_DIR, { recursive: true });
  writeFileSync(SYSTEMD_UNIT_PATH, unit);
  ok('Wrote unit file: ' + SYSTEMD_UNIT_PATH);

  const reload = spawnSync('systemctl', ['--user', 'daemon-reload']);
  if (reload.status !== 0) {
    warn('systemctl --user daemon-reload failed (is systemd available?)');
  } else {
    ok('Reloaded systemd');
  }

  const enable = spawnSync('systemctl', ['--user', 'enable', SYSTEMD_UNIT_NAME]);
  if (enable.status === 0) ok('Enabled at boot');
  else warn('systemctl --user enable failed');

  const start = spawnSync('systemctl', ['--user', 'start', SYSTEMD_UNIT_NAME]);
  if (start.status === 0) ok('Started');
  else warn('systemctl --user start failed');

  console.log();
  info('Check status:  systemctl --user status alvasta-gateway');
  info('View logs:     journalctl --user -u alvasta-gateway -f');
  console.log();
}

function uninstallSystemd() {
  spawnSync('systemctl', ['--user', 'stop', SYSTEMD_UNIT_NAME]);
  spawnSync('systemctl', ['--user', 'disable', SYSTEMD_UNIT_NAME]);
  if (existsSync(SYSTEMD_UNIT_PATH)) {
    unlinkSync(SYSTEMD_UNIT_PATH);
    ok('Removed unit file');
  }
  spawnSync('systemctl', ['--user', 'daemon-reload']);
  ok('Daemon uninstalled');
}

function statusSystemd() {
  if (!existsSync(SYSTEMD_UNIT_PATH)) {
    info('not installed');
    info('Run: alvasta daemon install');
    return;
  }
  ok('unit file: ' + SYSTEMD_UNIT_PATH);
  const status = spawnSync('systemctl', ['--user', 'is-active', SYSTEMD_UNIT_NAME], { encoding: 'utf8' });
  const enabled = spawnSync('systemctl', ['--user', 'is-enabled', SYSTEMD_UNIT_NAME], { encoding: 'utf8' });
  console.log('  active:  ' + (status.stdout?.trim() || 'unknown'));
  console.log('  enabled: ' + (enabled.stdout?.trim() || 'unknown'));
}

// ─── macOS: launchd LaunchAgent ─────────────────────────

const LAUNCHD_DIR = join(homedir(), 'Library/LaunchAgents');
const LAUNCHD_LABEL = 'au.com.alvasta.gateway';
const LAUNCHD_PATH = join(LAUNCHD_DIR, LAUNCHD_LABEL + '.plist');

function installLaunchd() {
  const node = process.execPath;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${GATEWAY_BIN}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PATHS.logFile}</string>
  <key>StandardErrorPath</key>
  <string>${PATHS.logFile}</string>
</dict>
</plist>
`;
  mkdirSync(LAUNCHD_DIR, { recursive: true });
  writeFileSync(LAUNCHD_PATH, plist);
  ok('Wrote LaunchAgent: ' + LAUNCHD_PATH);

  spawnSync('launchctl', ['unload', LAUNCHD_PATH]); // ignore errors
  const load = spawnSync('launchctl', ['load', LAUNCHD_PATH]);
  if (load.status === 0) ok('Loaded into launchd');
  else warn('launchctl load failed');

  console.log();
  info('Check status: launchctl list | grep alvasta');
  info('View logs:    tail -f ' + PATHS.logFile);
  console.log();
}

function uninstallLaunchd() {
  spawnSync('launchctl', ['unload', LAUNCHD_PATH]);
  if (existsSync(LAUNCHD_PATH)) {
    unlinkSync(LAUNCHD_PATH);
    ok('Removed LaunchAgent');
  } else {
    info('Already removed.');
  }
}

function statusLaunchd() {
  if (!existsSync(LAUNCHD_PATH)) {
    info('not installed');
    info('Run: alvasta daemon install');
    return;
  }
  ok('LaunchAgent: ' + LAUNCHD_PATH);
  const list = spawnSync('launchctl', ['list', LAUNCHD_LABEL], { encoding: 'utf8' });
  if (list.status === 0) {
    ok('loaded');
  } else {
    warn('not loaded');
  }
}

// ─── Windows: Task Scheduler at logon ───────────────────

const TASK_NAME = 'AlvastaGateway';

function installTaskScheduler() {
  const node = process.execPath;
  // /F = force overwrite, /SC ONLOGON = run at user logon, /RL HIGHEST = no admin prompt
  const args = [
    '/Create',
    '/F',
    '/TN', TASK_NAME,
    '/SC', 'ONLOGON',
    '/RL', 'LIMITED',
    '/TR', `"${node}" "${GATEWAY_BIN}"`,
    '/IT'
  ];
  const create = spawnSync('schtasks', args, { encoding: 'utf8' });
  if (create.status === 0) {
    ok('Scheduled task created: ' + TASK_NAME);
    info('Will start automatically every time you log in.');
    console.log();
    info('Manually run now:  schtasks /Run /TN ' + TASK_NAME);
    info('View logs:         type ' + PATHS.logFile);
    info('Or with the GUI:   taskschd.msc');
  } else {
    fail('schtasks failed: ' + (create.stderr?.trim() || create.stdout?.trim() || 'unknown'));
  }
}

function uninstallTaskScheduler() {
  const del = spawnSync('schtasks', ['/Delete', '/F', '/TN', TASK_NAME], { encoding: 'utf8' });
  if (del.status === 0) {
    ok('Scheduled task deleted');
  } else {
    warn('schtasks /Delete failed: ' + (del.stderr?.trim() || 'maybe not installed'));
  }
}

function statusTaskScheduler() {
  const query = spawnSync('schtasks', ['/Query', '/TN', TASK_NAME], { encoding: 'utf8' });
  if (query.status === 0) {
    ok('Scheduled task installed: ' + TASK_NAME);
    console.log(query.stdout);
  } else {
    info('not installed');
    info('Run: alvasta daemon install');
  }
}
