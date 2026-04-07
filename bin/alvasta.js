#!/usr/bin/env node
// alvasta — main user-facing CLI
// Subcommands: onboard, start, stop, restart, status, doctor, channel, memory, config
import { onboardCmd } from '../src/cli/onboard.js';
import { startCmd, stopCmd, restartCmd, statusCmd, doctorCmd } from '../src/cli/lifecycle.js';
import { upgradeCmd } from '../src/cli/upgrade.js';
import { color } from '../src/cli/util.js';

const VERSION = '0.2.0-alpha.1';

const args = process.argv.slice(2);
const cmd = args[0];

const HELP = `
${color.bold(color.orange('ALVASTA'))} ${color.dim('v' + VERSION)}
${color.dim('Personal AI assistant — runs on your machine, uses your Claude account')}

${color.bold('Usage:')}
  alvasta <command> [args]

${color.bold('Core:')}
  ${color.cyan('onboard')}              First-run setup wizard
  ${color.cyan('start')}                Start the gateway daemon
  ${color.cyan('stop')}                 Stop the gateway daemon
  ${color.cyan('restart')}              Restart the gateway daemon
  ${color.cyan('status')}               Show gateway + config + channels status
  ${color.cyan('doctor')}               Diagnose installation issues
  ${color.cyan('upgrade')}              Pull latest from git, reinstall deps, restart

${color.bold('Channels:')}
  ${color.cyan('channel list')}         List configured channels
  ${color.cyan('channel add <type>')}   Add a channel (telegram | discord | slack | web)
  ${color.cyan('channel remove <name>')}  Remove a channel

${color.bold('Sessions:')}
  ${color.cyan('session list')}         List active gateway sessions
  ${color.cyan('session show <id>')}    Show session details

${color.bold('Memory:')}
  ${color.cyan('memory show')}          List memory files
  ${color.cyan('memory edit')}          Open memory dir in $EDITOR
  ${color.cyan('memory backup')}        Backup memory directory

${color.bold('Other:')}
  ${color.cyan('config')}               Edit config in $EDITOR
  ${color.cyan('chat')}                 Start an interactive chat session
  ${color.cyan('version')}              Show version
  ${color.cyan('help')}                 Show this help

${color.dim('Docs: https://alvasta.com.au')}
`;

async function main() {
  switch (cmd) {
    case 'onboard':
      await onboardCmd();
      break;
    case 'start':
      await startCmd();
      break;
    case 'stop':
      await stopCmd();
      break;
    case 'restart':
      await restartCmd();
      break;
    case 'status':
      await statusCmd();
      break;
    case 'doctor':
      await doctorCmd();
      break;
    case 'upgrade':
    case 'update':
      await upgradeCmd();
      break;
    case 'channel': {
      const sub = args[1];
      if (sub === 'list') {
        const { loadConfig } = await import('../src/cli/util.js');
        const config = loadConfig();
        const channels = Object.entries(config.channels);
        if (!channels.length) console.log('No channels configured. Run: alvasta channel add telegram');
        else channels.forEach(([name, c]) => console.log(`  ${name}: ${c.enabled ? color.green('enabled') : color.dim('disabled')}`));
      } else if (sub === 'add') {
        const type = args[2];
        if (type === 'telegram') {
          const { setupTelegram } = await import('../src/cli/channels/telegram.js');
          const { loadConfig, saveConfig } = await import('../src/cli/util.js');
          const cfg = await setupTelegram();
          if (cfg) {
            const c = loadConfig();
            c.channels.telegram = cfg;
            saveConfig(c);
            console.log(color.green('  ✓ Saved.'));
          }
        } else {
          console.log('Channel type not yet supported: ' + type);
        }
      } else {
        console.log('Usage: alvasta channel <list|add|remove>');
      }
      break;
    }
    case 'memory': {
      const sub = args[1];
      const { spawn } = await import('node:child_process');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const { existsSync, readdirSync, statSync } = await import('node:fs');
      const memDir = join(homedir(), '.claude/projects/-home-' + process.env.USER + '/memory');
      if (!existsSync(memDir)) {
        console.log('No memory directory at ' + memDir);
        break;
      }
      if (sub === 'show' || !sub) {
        const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
        console.log(`\n${color.bold('Memory:')} ${color.dim(memDir)}\n`);
        files.forEach(f => {
          const s = statSync(join(memDir, f));
          console.log(`  ${color.cyan(f.padEnd(40))} ${color.dim((s.size / 1024).toFixed(1) + ' KB')}`);
        });
        console.log();
      } else if (sub === 'edit') {
        const editor = process.env.EDITOR || 'vi';
        spawn(editor, [memDir], { stdio: 'inherit' });
      }
      break;
    }
    case 'version':
    case '--version':
    case '-v':
      console.log('alvasta v' + VERSION);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.log(`Unknown command: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(color.red('Error: ' + err.message));
  process.exit(1);
});
