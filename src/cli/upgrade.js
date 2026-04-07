// alvasta upgrade — pull latest from git, reinstall deps if needed, restart daemon
//
// Detects if the install is a git clone (has .git/) and runs `git pull`.
// If not a clone, instructs the user to switch to a clone.
// Re-runs `npm install` only if package.json changed.
// Then restarts the daemon if it was running.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, header, ok, fail, info, warn } from './util.js';
import { restartCmd, statusCmd } from './lifecycle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    ...opts
  });
}

export async function upgradeCmd() {
  header('UPGRADE');

  // 1. Check we're in a git clone
  const gitDir = resolve(REPO_ROOT, '.git');
  if (!existsSync(gitDir)) {
    fail('This install is not a git clone — cannot pull updates.');
    info('To enable upgrades, replace this install with a git clone:');
    console.log();
    console.log(color.cyan('  alvasta stop'));
    console.log(color.cyan('  cd ' + dirname(REPO_ROOT)));
    console.log(color.cyan('  git clone https://github.com/LordVladious98/alvasta-gateway.git'));
    console.log(color.cyan('  cd alvasta-gateway'));
    console.log(color.cyan('  npm install && npm link'));
    console.log(color.cyan('  alvasta start'));
    console.log();
    return;
  }

  // 2. Check git is available
  const gitV = run('git', ['--version']);
  if (gitV.status !== 0) {
    fail('git not found in PATH. Install git first.');
    return;
  }

  // 3. Snapshot package.json mtime to detect if it changed
  const pkgPath = resolve(REPO_ROOT, 'package.json');
  const beforeMtime = existsSync(pkgPath) ? statSync(pkgPath).mtimeMs : 0;
  const beforeHead = run('git', ['rev-parse', 'HEAD']);
  const beforeShort = beforeHead.stdout?.trim().slice(0, 7) || 'unknown';

  // 4. git fetch + check if updates exist
  info('Fetching from origin...');
  const fetch = run('git', ['fetch', 'origin']);
  if (fetch.status !== 0) {
    fail('git fetch failed: ' + (fetch.stderr || '').trim());
    return;
  }
  ok('Fetched');

  // 5. Check if local is behind
  const status = run('git', ['rev-list', '--count', 'HEAD..origin/main']);
  const behind = parseInt(status.stdout?.trim() || '0', 10);

  if (behind === 0) {
    ok('Already up to date (' + beforeShort + ')');
    return;
  }

  info(`${behind} new commit${behind === 1 ? '' : 's'} on origin/main — pulling...`);

  // 6. git pull (with autostash for Windows line-ending edge cases)
  let pull = run('git', ['pull', '--ff-only', '--autostash', 'origin', 'main']);
  if (pull.status !== 0) {
    const err = (pull.stderr || '').toString();
    // Common Windows case: line ending differences flagged as local changes.
    // Try discarding them and retrying.
    if (err.includes('would be overwritten by merge') || err.includes('Your local changes')) {
      warn('Local file differences detected (likely Windows CRLF/LF). Discarding and retrying...');
      run('git', ['checkout', '--', '.']);
      pull = run('git', ['pull', '--ff-only', 'origin', 'main']);
    }
    if (pull.status !== 0) {
      fail('git pull failed: ' + ((pull.stderr || '').toString().trim() || 'unknown'));
      info('To force a clean state:');
      info('  git -C ' + REPO_ROOT + ' fetch origin');
      info('  git -C ' + REPO_ROOT + ' reset --hard origin/main');
      info('Then re-run: alvasta upgrade');
      return;
    }
  }
  ok('Pulled');

  const afterHead = run('git', ['rev-parse', 'HEAD']);
  const afterShort = afterHead.stdout?.trim().slice(0, 7) || 'unknown';
  info(`updated: ${beforeShort} → ${afterShort}`);

  // 7. Re-install if package.json changed
  const afterMtime = existsSync(pkgPath) ? statSync(pkgPath).mtimeMs : 0;
  if (afterMtime !== beforeMtime) {
    info('package.json changed, running npm install...');
    const install = run('npm', ['install'], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (install.status !== 0) {
      fail('npm install failed');
      return;
    }
    ok('Dependencies updated');
  } else {
    ok('Dependencies unchanged');
  }

  // 8. Restart daemon if it was running
  console.log();
  info('Restarting daemon...');
  await restartCmd();

  console.log();
  console.log('  ' + color.green('✓ Upgrade complete.'));
  console.log();
}
