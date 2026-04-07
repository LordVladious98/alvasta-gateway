// alvasta channel pair <type>
//
// Generates a one-time pairing code that the next message-sender on a channel
// must include to claim ownership. Eliminates the race condition where the
// first random user to find your bot gets the keys.
//
// Flow:
//   1. User runs `alvasta channel pair telegram`
//   2. CLI generates a 6-char code, stores it in config.channels.telegram.pairCode
//   3. Channel adapter (telegram-adapter.js) rejects all messages whose text
//      doesn't contain the pair code
//   4. When the matching code arrives, that chatId becomes the owner,
//      pairCode is cleared, and the bot starts responding normally

import { randomBytes } from 'node:crypto';
import { color, header, ok, fail, info, warn, loadConfig, saveConfig } from './util.js';

function generateCode() {
  // 6-char uppercase code, easy to read and type
  return randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

export async function pairCmd(args) {
  const channel = args[0];
  if (!channel) {
    fail('Usage: alvasta channel pair <telegram|discord|slack>');
    return;
  }

  const config = loadConfig();
  const ch = config.channels?.[channel];
  if (!ch) {
    fail(`Channel '${channel}' is not configured. Run: alvasta channel add ${channel}`);
    return;
  }

  const code = generateCode();
  ch.pairCode = code;
  ch.pairCodeIssuedAt = new Date().toISOString();
  // Clear existing owner so the next valid pair attempt can claim it
  if (args.includes('--clear-owner') || args.includes('--reset')) {
    ch.ownerChatId = null;
    ch.allowlist = [];
    info('Cleared existing owner and allowlist.');
  }
  saveConfig(config);

  header('PAIRING CODE');
  console.log();
  console.log('  ' + color.dim('channel: ') + color.bold(channel));
  console.log();
  console.log('  ' + color.dim('Send this exact code to your bot to claim ownership:'));
  console.log();
  console.log('    ' + color.bold(color.orange('  ' + code + '  ')));
  console.log();
  ok('Code stored — restart the gateway for it to take effect:');
  console.log('  ' + color.cyan('alvasta restart'));
  console.log();
  warn('Code is single-use. The next message containing this code claims ownership.');
  console.log();
}
