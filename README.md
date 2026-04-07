# Alvasta Gateway

> **The Claude-faithful personal AI. Memory-first. Multi-session. Runs on your machine.**

Alvasta is a personal AI assistant that runs entirely on your own device. It uses your existing Claude subscription, gives you persistent memory across sessions, and lets you reach your AI from any channel — Telegram, Discord, Slack, Web — without queuing.

Built in Melbourne by [Alvasta IT Solutions](https://alvasta.com.au). MIT licensed.

---

## Why Alvasta

The personal AI assistant space has gone where many open-source projects go: into a corporate acquisition. If you chose Claude on purpose — for the long context, the agentic loops, the tool use — you deserve a personal AI that's Claude-faithful, memory-first, and yours.

**What Alvasta is:**

- 🧠 **Memory-first.** Plain markdown knowledge base, work log, and learning files that persist across every session, channel, and machine. Read it with `cat`. Edit it with `vim`. Version it with `git`.
- 🦾 **Claude-faithful.** Claude only. Optimised for Opus 4.6 / Sonnet 4.6 / Haiku 4.5 — long context, native tool use, prompt caching. No multi-provider abstraction softening the experience.
- 🔌 **Multi-session, no queue.** Spawn one Claude Code child process per conversation. Three people can chat at the same time, on different channels, in parallel.
- 🏠 **Local-first.** No cloud, no telemetry, no SaaS. Your data lives in `~/.alvasta/` and never leaves your machine.
- 🛡️ **Inherits Claude Code OAuth.** No API keys to manage, no Anthropic partner application required. Uses `claude setup-token`.
- 🪶 **Inspectable.** ~10 packages, not 176. You can read every file in an afternoon.

**What Alvasta is not:**

- Not a wrapper around the Claude.ai web app (that's against the TOS)
- Not a multi-tenant SaaS (each user installs on their own machine)
- Not a multi-provider abstraction layer (Claude only)
- Not a no-code platform (you'll need to use a terminal)

---

## How it works

```
                    ┌─────────────────────────────────────────────┐
                    │         ALVASTA GATEWAY (background daemon)  │
                    │         WebSocket :: ws://127.0.0.1:18789    │
                    │                                              │
                    │   ┌──────────┐  ┌──────────┐  ┌──────────┐  │
                    │   │Session A │  │Session B │  │Session C │  │
                    │   │ alice    │  │ bob      │  │ carol    │  │
                    │   │ telegram │  │ discord  │  │ web      │  │
                    │   │   ↓      │  │   ↓      │  │   ↓      │  │
                    │   │ claude   │  │ claude   │  │ claude   │  │
                    │   │ child #1 │  │ child #2 │  │ child #3 │  │
                    │   └──────────┘  └──────────┘  └──────────┘  │
                    │                                              │
                    │            SQLite (sessions.db)              │
                    │      Shared memory directory (markdown)      │
                    └─────────────────────────────────────────────┘
                              ▲              ▲              ▲
                              │              │              │
                         ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐
                         │ Telegram │  │ Discord  │  │ Web UI   │
                         │ adapter  │  │ adapter  │  │          │
                         └──────────┘  └──────────┘  └──────────┘
```

Each session is a long-running `claude --print --input-format=stream-json --output-format=stream-json --resume <session-id>` child process. Multiple children run concurrently in the same Node host. The gateway routes WebSocket messages from channel adapters to the right child.

**Key insight:** because we spawn Claude Code, every session inherits Claude Code's OAuth, MCP servers, plugins, skills, and tools — for free. We don't reinvent any of it.

---

## Requirements

- **Node.js 22+** ([install](https://nodejs.org/))
- **Claude Code** ([install](https://docs.anthropic.com/claude-code))
- A **Claude subscription** (Claude Pro or Claude Max — required for `claude setup-token`)
- A **Telegram Bot token** if you want the Telegram channel (free, get from [@BotFather](https://t.me/BotFather))

---

## Install

### Option A — npm (recommended once published)

```bash
npm install -g @alvasta/gateway
alvasta onboard
```

### Option B — from source (current path)

```bash
git clone https://github.com/LordVladious98/alvasta-gateway.git
cd alvasta-gateway
npm install
npm link  # makes `alvasta` and `alvasta-gateway` available globally
alvasta onboard
```

---

## Quick Start

```bash
# 1. Verify the environment
$ alvasta doctor
[claude code]
  ✓ installed at /usr/local/bin/claude
  ✓ version 2.1.92
  ✓ auth working
[node]
  ✓ node v22.22.0

# 2. Run the wizard (one time)
$ alvasta onboard

  [1/5] Checking Claude Code...
    ✓ claude found
  [2/5] Authenticating with Anthropic...
    → Running: claude setup-token
    ✓ Token stored.
  [3/5] Verifying Claude works...
    ✓ Claude responded
  [4/5] Set up first channel?
    → Telegram
    → Paste your @BotFather token: 1234567890:ABC...
    ✓ Bot @YourAlvastaBot ready
  [5/5] Saving configuration...
    ✓ Config saved to ~/.alvasta/config.json

# 3. Start the daemon
$ alvasta start
  ✓ Gateway started (PID 12345)
  → Listening on ws://127.0.0.1:18789
  → Logs: ~/.alvasta/gateway.log

# 4. Open Telegram, message your bot. The first message claims ownership.
```

That's it. Now close every terminal — your bot keeps responding from your phone.

---

## CLI Reference

### Lifecycle

| Command | Description |
|---|---|
| `alvasta onboard` | First-run setup wizard |
| `alvasta start` | Start the gateway daemon (background) |
| `alvasta stop` | Stop the gateway daemon |
| `alvasta restart` | Restart the gateway daemon |
| `alvasta status` | Show gateway, config, channels status |
| `alvasta doctor` | Diagnose installation issues |

### Channels

| Command | Description |
|---|---|
| `alvasta channel list` | List configured channels |
| `alvasta channel add telegram` | Add a Telegram channel |
| `alvasta channel add discord` | Add a Discord channel (coming soon) |
| `alvasta channel add slack` | Add a Slack channel (coming soon) |
| `alvasta channel add web` | Enable the web UI channel (coming soon) |
| `alvasta channel remove <name>` | Remove a channel |

### Memory

| Command | Description |
|---|---|
| `alvasta memory show` | List memory files with sizes |
| `alvasta memory edit` | Open memory directory in `$EDITOR` |
| `alvasta memory backup` | Tar.gz the memory directory |

### Other

| Command | Description |
|---|---|
| `alvasta config` | Open config file in `$EDITOR` |
| `alvasta version` | Show version |
| `alvasta help` | Show help |

---

## Memory System

Alvasta's killer feature is persistent memory. Your AI knows who you are, what you're working on, and what you decided yesterday — across every session, on every channel.

Memory lives at `~/.claude/projects/-home-<username>/memory/` as plain markdown files:

```
memory/
├── MEMORY.md              # Index — auto-loaded into every session
├── user_profile.md        # Who you are, how you work
├── knowledge_base.md      # Environment, tools, preferences
├── project_worklog.md     # Active projects, current state, what was done
├── learning_<topic>.md    # Lessons learned (one file per topic)
├── feedback_<topic>.md    # Validated approaches and corrections
└── reference_<topic>.md   # External system pointers
```

Every memory file uses YAML frontmatter:

```markdown
---
name: Display Name
description: One-line hook used to decide relevance in future sessions
type: user | feedback | project | reference
---

Content here. For feedback/project memories, lead with the rule, then **Why:** and **How to apply:** lines.
```

Use `git` on this directory if you want history. It's just markdown.

---

## Configuration

`~/.alvasta/config.json` is generated by `alvasta onboard`:

```json
{
  "version": "0.2.0",
  "port": 18789,
  "host": "127.0.0.1",
  "model": null,
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "1234567890:ABC...",
      "bot": { "id": 123, "username": "YourBot", "name": "Your Bot" },
      "ownerChatId": "6678424626",
      "allowlist": ["6678424626"]
    }
  },
  "onboarded": true
}
```

Edit with `alvasta config`.

---

## Architecture Notes

### Spawning model
Each session is a long-running child process:
```bash
claude --print \
       --input-format stream-json \
       --output-format stream-json \
       --verbose \
       --include-partial-messages \
       --permission-mode acceptEdits \
       --resume <session-id>
```

The gateway pipes user messages into stdin, parses stream-json events from stdout, and forwards them to channel adapters via WebSocket.

### Why multiple processes (not one Node process with the SDK)?
Because we get OAuth, plugins, MCP servers, hooks, skills, slash commands, and the entire Claude Code agent loop **for free**. Spawning is a tiny cost for inheriting all of that.

### Session persistence
Claude Code's session ID is stored in SQLite (`~/.alvasta/sessions.db`). On gateway restart, sessions resume via `--resume`.

### Auth model
**Single-tenant.** One Anthropic account powers the gateway. Multiple users connect, all share that account. Perfect for personal use, family, small team. Each user installs Alvasta on their own machine — no centralised SaaS, no multi-tenant complexity.

### Concurrency claim (proven)
The smoke test (`npm test`) connects 3 users simultaneously, sends 3 messages at the same instant, and verifies:
- 3 distinct session IDs
- First-token spread under 5 seconds (proving parallel execution, not serialization)

A serialized implementation would show ~24s spread; we measure ~400ms.

---

## Roadmap

### v0.2 (current)
- [x] Multi-session gateway with concurrency proof
- [x] CLI: onboard, start, stop, status, doctor
- [x] Telegram channel adapter with streaming edits
- [x] SQLite session persistence
- [ ] Discord channel adapter
- [ ] Slack channel adapter
- [ ] Web UI (chat + memory browser)
- [ ] Smart model routing (Haiku/Sonnet/Opus per request)
- [ ] systemd unit
- [ ] Docker image

### v0.3
- [ ] Voice channel (Whisper STT + ElevenLabs TTS via MCP)
- [ ] Browser automation MCP bundle (Puppeteer)
- [ ] Cross-session memory handoff
- [ ] Encrypted memory backups

### v1.0
- [ ] Native Mac/Windows/Linux desktop wrapper
- [ ] Mobile PWA
- [ ] Anthropic partner status (optional)
- [ ] alvasta.cloud hosted option

---

## Companion: Alvasta Plugin

Alvasta also ships as a [Claude Code plugin](https://github.com/LordVladious98/alvasta-plugin) for in-terminal use:

```bash
/plugin marketplace add LordVladious98/alvasta-plugin
/plugin install alvasta@alvasta
/alvasta:start
```

The plugin shares the same memory directory, so the gateway and the plugin work together seamlessly. Use the plugin when you're actively coding in Claude Code; use the gateway when you want your AI to be reachable from any channel.

---

## Contributing

PRs welcome. Keep it simple, keep it inspectable. The whole project should be readable in an afternoon.

```bash
git clone https://github.com/LordVladious98/alvasta-gateway.git
cd alvasta-gateway
npm install
npm test  # smoke test (requires `claude` authenticated)
```

---

## License

MIT © 2026 Alvasta IT Solutions, Melbourne

---

## Credits

Built on top of [Claude Code](https://docs.anthropic.com/claude-code) by Anthropic. Inspired by — and competing with — openclaw. Sustained by [Alvasta IT Solutions](https://alvasta.com.au).
