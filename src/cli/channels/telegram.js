// Telegram channel setup helper
import { color, ok, fail, info, warn, prompt } from '../util.js';

export async function setupTelegram() {
  console.log();
  console.log(color.dim('  ─────────────────────────────────────────────'));
  console.log(color.bold('  TELEGRAM SETUP'));
  console.log(color.dim('  ─────────────────────────────────────────────'));
  console.log();
  console.log('  ' + color.cyan('1.') + ' Open Telegram and message ' + color.bold('@BotFather'));
  console.log('  ' + color.cyan('2.') + ' Send: ' + color.bold('/newbot'));
  console.log('  ' + color.cyan('3.') + ' Pick a name and username for your bot');
  console.log('  ' + color.cyan('4.') + ' Copy the token (looks like ' + color.dim('1234567890:ABC...') + ')');
  console.log();

  const token = await prompt('Paste your bot token (or "skip"):');
  if (!token || token.toLowerCase() === 'skip') {
    info('Skipped.');
    return null;
  }

  // Validate token format
  if (!/^\d{8,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    fail('Token format looks wrong. Should be like 1234567890:ABCdef...');
    return null;
  }

  // Try to call getMe to verify it
  info('Verifying token with Telegram...');
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (!data.ok) {
      fail('Telegram rejected the token: ' + (data.description || 'unknown error'));
      return null;
    }
    ok(`Bot @${data.result.username} (${data.result.first_name}) verified.`);

    // Try to set commands menu
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: 'Start a new conversation' },
          { command: 'status', description: 'Show Alvasta status' },
          { command: 'memory', description: 'Show memory state' },
          { command: 'resume', description: 'Resume last project' },
          { command: 'help', description: 'Show help' }
        ]
      })
    });
    ok('Bot commands menu configured.');

    // Set description
    await fetch(`https://api.telegram.org/bot${token}/setMyDescription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Your personal AI assistant powered by Alvasta. Memory-first, Claude-faithful, runs on your own machine.'
      })
    });

    console.log();
    info('On first message to your bot, you become the owner (allowlist locks others out).');
    console.log();

    return {
      enabled: true,
      token,
      bot: {
        id: data.result.id,
        username: data.result.username,
        name: data.result.first_name
      },
      ownerChatId: null, // set on first message
      allowlist: [],
      addedAt: new Date().toISOString()
    };
  } catch (err) {
    fail('Failed to reach Telegram API: ' + err.message);
    return null;
  }
}
