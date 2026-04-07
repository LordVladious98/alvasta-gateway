#!/usr/bin/env node
// alvasta — main user-facing CLI
// Subcommands: onboard, start, stop, restart, status, doctor, channel, memory, config
import { onboardCmd } from '../src/cli/onboard.js';
import { startCmd, stopCmd, restartCmd, statusCmd, doctorCmd } from '../src/cli/lifecycle.js';
import { upgradeCmd } from '../src/cli/upgrade.js';
import { memoryCmd } from '../src/cli/memory.js';
import { color, PATHS, ensureWorkspace, info } from '../src/cli/util.js';

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
  ${color.cyan('memory show')}          List memory files with sizes
  ${color.cyan('memory search <q>')}    Search memory for a term (highlighted matches)
  ${color.cyan('memory edit')}          Open memory dir in $EDITOR
  ${color.cyan('memory backup [name]')} Backup memory directory
  ${color.cyan('memory restore <name>')} Restore from a backup
  ${color.cyan('memory path')}          Print the memory directory path

${color.bold('Tools (MCP servers):')}
  ${color.cyan('tool list')}            List configured MCP servers
  ${color.cyan('tool edit')}            Edit workspace .mcp.json
  ${color.cyan('tool path')}            Print the .mcp.json path

${color.bold('Other:')}
  ${color.cyan('workspace')}            Print the alvasta workspace dir
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
    case 'memory':
      await memoryCmd(args.slice(1));
      break;
    case 'tool':
    case 'tools': {
      const sub = args[1];
      const { existsSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      ensureWorkspace();
      const mcpFile = join(PATHS.workspaceDir, '.mcp.json');
      if (sub === 'list' || !sub) {
        if (!existsSync(mcpFile)) {
          console.log('No .mcp.json at ' + mcpFile);
          break;
        }
        const cfg = JSON.parse(readFileSync(mcpFile, 'utf8'));
        console.log();
        console.log('  ' + color.bold('MCP servers in workspace .mcp.json:'));
        console.log();
        for (const [name, def] of Object.entries(cfg)) {
          if (name.startsWith('$') || name.startsWith('_')) {
            const enabled = name.startsWith('_') ? color.dim('disabled') : color.dim('meta');
            const cleanName = name.replace(/^_/, '');
            console.log('  ' + color.cyan(cleanName.padEnd(20)) + ' ' + enabled + (def._note ? '  ' + color.dim(def._note) : ''));
          } else {
            console.log('  ' + color.cyan(name.padEnd(20)) + ' ' + color.green('enabled'));
          }
        }
        console.log();
        info('Edit ' + mcpFile + ' to enable a tool. Rename _name to name.');
      } else if (sub === 'edit') {
        const { spawn } = await import('node:child_process');
        const editor = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
        spawn(editor, [mcpFile], { stdio: 'inherit', shell: process.platform === 'win32' });
      } else if (sub === 'path') {
        console.log(mcpFile);
      } else {
        console.log('Usage: alvasta tool <list|edit|path>');
      }
      break;
    }
    case 'workspace': {
      ensureWorkspace();
      console.log(PATHS.workspaceDir);
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
