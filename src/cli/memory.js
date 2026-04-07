// alvasta memory show / search / edit / backup / restore
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { color, header, ok, fail, info, warn, IS_WINDOWS } from './util.js';

function findMemoryDir() {
  // Try common locations
  const user = process.env.USER || process.env.USERNAME || basename(homedir());
  const candidates = [
    join(homedir(), '.claude/projects/-home-' + user + '/memory'),
    join(homedir(), '.claude/projects/' + user + '/memory'),
    join(homedir(), '.claude/memory'),
    join(homedir(), '.alvasta/memory')
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fallback: look under ~/.claude/projects/* for any memory dir
  const projectsDir = join(homedir(), '.claude/projects');
  if (existsSync(projectsDir)) {
    for (const project of readdirSync(projectsDir)) {
      const memDir = join(projectsDir, project, 'memory');
      if (existsSync(memDir)) return memDir;
    }
  }
  return null;
}

export async function memoryCmd(args) {
  const sub = args[0] || 'show';
  const memDir = findMemoryDir();
  if (!memDir) {
    fail('No memory directory found.');
    info('Expected at: ~/.claude/projects/-home-<user>/memory/');
    return;
  }

  switch (sub) {
    case 'show':
    case 'list':
      return showMemory(memDir);
    case 'search':
      return searchMemory(memDir, args.slice(1).join(' '));
    case 'edit':
      return editMemory(memDir);
    case 'backup':
      return backupMemory(memDir, args[1]);
    case 'restore':
      return restoreMemory(memDir, args[1]);
    case 'path':
      console.log(memDir);
      return;
    default:
      console.log('Usage: alvasta memory <show|search|edit|backup|restore|path>');
  }
}

function showMemory(memDir) {
  header('MEMORY');
  console.log();
  console.log('  ' + color.dim('path: ' + memDir));
  console.log();
  const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
  if (!files.length) {
    info('Empty.');
    return;
  }
  // Show MEMORY.md first if present
  const ordered = [
    ...files.filter(f => f === 'MEMORY.md'),
    ...files.filter(f => f !== 'MEMORY.md').sort()
  ];
  for (const f of ordered) {
    const s = statSync(join(memDir, f));
    const sizeKb = (s.size / 1024).toFixed(1);
    const mtime = new Date(s.mtimeMs).toISOString().slice(0, 10);
    console.log('  ' + color.cyan(f.padEnd(40)) + ' ' + color.dim(sizeKb.padStart(6) + ' KB  ' + mtime));
  }
  console.log();
}

function searchMemory(memDir, query) {
  header('MEMORY SEARCH');
  if (!query) {
    fail('Usage: alvasta memory search <query>');
    return;
  }
  console.log();
  console.log('  ' + color.dim('query: ' + query));
  console.log();
  const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
  const lower = query.toLowerCase();
  let totalHits = 0;

  for (const f of files) {
    const path = join(memDir, f);
    const lines = readFileSync(path, 'utf8').split('\n');
    const hits = [];
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(lower)) {
        hits.push({ lineNo: i + 1, text: line.trim() });
      }
    });
    if (hits.length) {
      console.log('  ' + color.cyan(f) + ' ' + color.dim('(' + hits.length + ' match' + (hits.length === 1 ? '' : 'es') + ')'));
      for (const h of hits.slice(0, 5)) {
        const highlighted = h.text.replace(new RegExp(query, 'gi'), m => color.orange(m));
        console.log('    ' + color.dim(String(h.lineNo).padStart(4) + ':') + ' ' + highlighted.slice(0, 120));
      }
      if (hits.length > 5) console.log('    ' + color.dim('... ' + (hits.length - 5) + ' more'));
      console.log();
      totalHits += hits.length;
    }
  }

  if (totalHits === 0) {
    info('No matches.');
  } else {
    console.log('  ' + color.green(totalHits + ' total match' + (totalHits === 1 ? '' : 'es')));
  }
  console.log();
}

function editMemory(memDir) {
  const editor = process.env.EDITOR || (IS_WINDOWS ? 'notepad' : 'vi');
  info('Opening ' + memDir + ' in ' + editor);
  spawn(editor, [memDir], { stdio: 'inherit', shell: IS_WINDOWS });
}

function backupMemory(memDir, customName) {
  header('MEMORY BACKUP');
  const backupDir = join(homedir(), '.alvasta/backups');
  mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = customName || 'memory-' + ts;
  const backupPath = join(backupDir, name);
  mkdirSync(backupPath, { recursive: true });

  const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const src = readFileSync(join(memDir, f), 'utf8');
    writeFileSync(join(backupPath, f), src);
  }

  ok('Backed up ' + files.length + ' file(s) to:');
  console.log('  ' + color.dim(backupPath));
  console.log();
}

function restoreMemory(memDir, name) {
  header('MEMORY RESTORE');
  const backupDir = join(homedir(), '.alvasta/backups');
  if (!existsSync(backupDir)) {
    fail('No backups directory at ' + backupDir);
    return;
  }
  const backups = readdirSync(backupDir).filter(d =>
    statSync(join(backupDir, d)).isDirectory()
  ).sort().reverse();

  if (!backups.length) {
    fail('No backups found.');
    return;
  }

  if (!name) {
    info('Available backups:');
    backups.forEach(b => console.log('  ' + color.cyan(b)));
    info('Restore with: alvasta memory restore <name>');
    return;
  }

  if (!backups.includes(name)) {
    fail('Backup not found: ' + name);
    info('Available: ' + backups.join(', '));
    return;
  }

  const backupPath = join(backupDir, name);
  const files = readdirSync(backupPath).filter(f => f.endsWith('.md'));

  // Make a safety backup of current memory before restoring
  warn('Restoring will overwrite current memory. Making safety backup first...');
  backupMemory(memDir, 'safety-before-restore-' + Date.now());

  for (const f of files) {
    const src = readFileSync(join(backupPath, f), 'utf8');
    writeFileSync(join(memDir, f), src);
  }
  ok('Restored ' + files.length + ' file(s) from ' + name);
  console.log();
}
