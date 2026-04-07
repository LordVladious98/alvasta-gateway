// alvasta onboard — first-run setup wizard
//
// 1. Check Claude Code is installed
// 2. Run `claude setup-token` (Claude Code's own auth flow)
// 3. Verify Claude works with a test prompt
// 4. Optionally configure first channel (telegram/discord/web)
// 5. Save config, advise on starting the gateway

import { spawn, spawnSync } from 'node:child_process';
import { color, header, step, ok, fail, info, warn, prompt, promptChoice, loadConfig, saveConfig } from './util.js';
import { setupTelegram } from './channels/telegram.js';

export async function onboardCmd() {
  header('ONBOARDING');

  const config = loadConfig();

  // ─── 1. Check Claude Code ───
  step(1, 5, 'Checking Claude Code...');
  const which = spawnSync('which', ['claude']);
  if (which.status !== 0) {
    fail('claude not found in PATH');
    info('Install with: npm install -g @anthropic-ai/claude-code');
    process.exit(1);
  }
  ok('claude found at ' + which.stdout.toString().trim());
  const ver = spawnSync('claude', ['--version']);
  if (ver.status === 0) {
    ok('version ' + ver.stdout.toString().trim());
  }

  // ─── 2. Authenticate ───
  step(2, 5, 'Authenticating with Anthropic...');
  const authCheck = spawnSync('claude', ['--print', 'reply with just OK'], { timeout: 30000 });
  if (authCheck.status === 0 && authCheck.stdout.toString().trim().toLowerCase().includes('ok')) {
    ok('Already authenticated.');
  } else {
    info('Running: claude setup-token');
    info('A browser window may open. Sign in with your Claude account.');
    const setup = spawnSync('claude', ['setup-token'], { stdio: 'inherit' });
    if (setup.status !== 0) {
      fail('Authentication failed.');
      process.exit(1);
    }
    ok('Token stored.');
  }

  // ─── 3. Verify ───
  step(3, 5, 'Verifying Claude works...');
  info('Sending test prompt...');
  const test = spawnSync('claude', ['--print', 'reply with just the word READY'], { timeout: 60000 });
  if (test.status !== 0) {
    fail('Test failed: ' + test.stderr.toString().trim());
    process.exit(1);
  }
  const out = test.stdout.toString().trim();
  if (out.toLowerCase().includes('ready')) {
    ok('Claude responded: ' + out.slice(0, 60));
  } else {
    warn('Unexpected response: ' + out.slice(0, 60));
    warn('Continuing anyway.');
  }

  // ─── 4. Channel setup ───
  step(4, 5, 'Set up first channel?');
  const channelChoice = await promptChoice('Pick a channel:', [
    { label: 'Telegram (recommended)', value: 'telegram' },
    { label: 'Web (later)', value: 'web' },
    { label: 'Skip for now', value: 'skip' }
  ]);

  if (channelChoice === 'telegram') {
    const tgConfig = await setupTelegram();
    if (tgConfig) {
      config.channels.telegram = tgConfig;
      ok('Telegram channel configured.');
    }
  } else if (channelChoice === 'web') {
    config.channels.web = { port: 18790, enabled: false };
    info('Web channel scaffolded but not enabled. Run: alvasta channel enable web');
  } else {
    info('Skipped. Add a channel later: alvasta channel add telegram');
  }

  // ─── 5. Done ───
  step(5, 5, 'Saving configuration...');
  config.onboarded = true;
  config.onboardedAt = new Date().toISOString();
  saveConfig(config);
  ok('Config saved to ' + color.dim(require('node:path').join(require('node:os').homedir(), '.alvasta/config.json')));

  console.log();
  console.log(color.bold(color.green('═══════════════════════════════')));
  console.log(color.bold(color.green('ALVASTA READY')));
  console.log(color.bold(color.green('═══════════════════════════════')));
  console.log();
  console.log('  Start gateway:  ' + color.cyan('alvasta start'));
  console.log('  Check status:   ' + color.cyan('alvasta status'));
  console.log('  Stop gateway:   ' + color.cyan('alvasta stop'));
  console.log();
}
