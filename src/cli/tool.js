// alvasta tool <list|enable|disable|edit|path|set>
//
// Manages the workspace .mcp.json registry.
// MCP servers are stored with leading underscore when disabled (e.g. _puppeteer)
// and without when enabled (puppeteer). The CLI handles renaming and env-var
// substitution so users don't have to hand-edit JSON.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { color, header, ok, fail, info, warn, ensureWorkspace, PATHS, IS_WINDOWS } from './util.js';

function loadMcp() {
  ensureWorkspace();
  const path = join(PATHS.workspaceDir, '.mcp.json');
  if (!existsSync(path)) return { path, data: {} };
  return { path, data: JSON.parse(readFileSync(path, 'utf8')) };
}

function saveMcp(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function isMeta(key) { return key.startsWith('$'); }
function isDisabled(key) { return key.startsWith('_'); }
function cleanName(key) { return key.replace(/^_/, ''); }

export async function toolCmd(args) {
  const sub = args[0] || 'list';
  switch (sub) {
    case 'list':   return listTools();
    case 'enable': return enableTool(args[1], args.slice(2));
    case 'disable': return disableTool(args[1]);
    case 'edit':   return editTool();
    case 'path':   return pathTool();
    case 'set':    return setEnv(args[1], args[2], args[3]);
    default:
      console.log('Usage: alvasta tool <list|enable|disable|edit|path|set>');
      console.log('  alvasta tool list                      # show all tools');
      console.log('  alvasta tool enable <name> [k=v ...]   # enable a tool, optionally set env vars');
      console.log('  alvasta tool disable <name>            # disable a tool');
      console.log('  alvasta tool set <name> <key> <value>  # set an env var on an enabled tool');
      console.log('  alvasta tool edit                      # open .mcp.json in $EDITOR');
      console.log('  alvasta tool path                      # print .mcp.json path');
  }
}

function listTools() {
  header('TOOLS');
  const { data } = loadMcp();
  console.log();
  let enabled = 0, disabled = 0;
  for (const [key, def] of Object.entries(data)) {
    if (isMeta(key)) continue;
    const name = cleanName(key);
    const status = isDisabled(key)
      ? color.dim('disabled')
      : color.green(' enabled');
    if (isDisabled(key)) disabled++; else enabled++;
    const note = def._note || '';
    console.log('  ' + status + '  ' + color.cyan(name.padEnd(16)) + '  ' + color.dim(note));
  }
  console.log();
  console.log('  ' + color.dim(`${enabled} enabled, ${disabled} disabled`));
  console.log();
  if (disabled > 0) {
    info('Enable a tool: alvasta tool enable <name>');
  }
  console.log();
}

function enableTool(name, kvArgs) {
  if (!name) {
    fail('Usage: alvasta tool enable <name> [KEY=VALUE ...]');
    return;
  }
  const { path, data } = loadMcp();
  const disabledKey = '_' + name;
  if (data[name]) {
    warn(`'${name}' is already enabled.`);
    return;
  }
  if (!data[disabledKey]) {
    fail(`No tool named '${name}' in the registry.`);
    info('Run alvasta tool list to see available tools.');
    return;
  }

  // Move _name → name
  const def = data[disabledKey];
  delete data[disabledKey];

  // Apply key=value env overrides
  if (kvArgs && kvArgs.length) {
    if (!def.env) def.env = {};
    for (const kv of kvArgs) {
      const eq = kv.indexOf('=');
      if (eq === -1) {
        warn(`Skipping invalid arg '${kv}' (expected KEY=VALUE)`);
        continue;
      }
      const k = kv.slice(0, eq);
      const v = kv.slice(eq + 1);
      def.env[k] = v;
    }
  }

  // Strip the _note metadata since it's not a real MCP field
  delete def._note;

  data[name] = def;
  saveMcp(path, data);

  header('TOOL ENABLED');
  console.log();
  ok(`'${name}' enabled in ${path}`);
  if (def.env) {
    console.log();
    console.log('  ' + color.dim('Environment:'));
    for (const [k, v] of Object.entries(def.env)) {
      const masked = (k.toLowerCase().includes('key') || k.toLowerCase().includes('token') || k.toLowerCase().includes('secret'))
        ? v.slice(0, 4) + '***' + v.slice(-4)
        : v;
      console.log('  ' + color.cyan('  ' + k.padEnd(28)) + ' ' + color.dim(masked));
    }
  }
  console.log();
  warn('Restart the gateway for the change to take effect:  alvasta restart');
  console.log();
}

function disableTool(name) {
  if (!name) {
    fail('Usage: alvasta tool disable <name>');
    return;
  }
  const { path, data } = loadMcp();
  if (!data[name]) {
    warn(`'${name}' is not enabled.`);
    return;
  }
  data['_' + name] = data[name];
  delete data[name];
  saveMcp(path, data);
  header('TOOL DISABLED');
  console.log();
  ok(`'${name}' disabled.`);
  warn('Restart the gateway:  alvasta restart');
  console.log();
}

function setEnv(name, key, value) {
  if (!name || !key || value === undefined) {
    fail('Usage: alvasta tool set <name> <key> <value>');
    return;
  }
  const { path, data } = loadMcp();
  const def = data[name] || data['_' + name];
  if (!def) {
    fail(`No tool named '${name}'.`);
    return;
  }
  if (!def.env) def.env = {};
  def.env[key] = value;
  saveMcp(path, data);
  ok(`Set ${key} on '${name}'.`);
  warn('Restart the gateway:  alvasta restart');
}

function editTool() {
  const { path } = loadMcp();
  const editor = process.env.EDITOR || (IS_WINDOWS ? 'notepad' : 'vi');
  spawn(editor, [path], { stdio: 'inherit', shell: IS_WINDOWS });
}

function pathTool() {
  const { path } = loadMcp();
  console.log(path);
}
