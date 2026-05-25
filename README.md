# Jetstream

**A native macOS GUI shell for Claude CLI** — multi-session, multi-pane, built on top of the full Claude Code harness.

---

## What it is

Jetstream is a Tauri desktop app that wraps the `claude` CLI in a modern three-pane interface. It gives you the power of Claude Code's agentic engine — tools, subagents, permission modes, session history, slash commands, the whole thing — inside a purpose-built GUI designed for running multiple sessions simultaneously.

It doesn't replace Claude Code. It augments it. Under the hood, Jetstream spawns real `claude` processes in `stream-json` mode, wires their output into a reactive UI, and lets you manage many concurrent agentic sessions across different working directories without touching a terminal.

---

## Why not just use Cursor, Windsurf, or Copilot?

Those tools bundle their own model access — you pay their subscription, get their context window, their tool set, their rate limits. When Claude releases a new model or a new agentic capability, you wait for them to ship it.

Jetstream is different:

- **Your subscription, your limits.** It runs against your own `claude` CLI, which uses your Anthropic or Claude.ai subscription. Every capability Claude Code ships — new models, extended thinking, MCP servers, agents, hooks — is available the day it lands, with no middleman.
- **The full harness, not a stripped-down API.** Cursor and friends call the Claude API directly with a limited tool set. Jetstream runs the actual `claude` binary, which means you get every feature the CLI exposes: `/compact`, `/memory`, session resumption, `--dangerously-skip-permissions`, the whole plugin ecosystem, hooks you've configured globally.
- **Multi-session from the ground up.** Run an agent fixing a bug in one pane, another writing tests in a second session, a third doing research — all from different working directories, all simultaneously.
- **Transparent cost tracking.** Every session shows live token usage and USD cost from the real Claude API response, not an estimate.

---

## Features

- **Three-pane layout** — workspace switcher (left), active chat with live todo panel (center), subagents + token/cost view (right)
- **Multi-session** — unlimited concurrent sessions per working directory; sessions persist and are resumable across restarts
- **Full permission mode control** — cycle through `bypassPermissions`, `plan`, and `acceptEdits` with Shift+Tab; color-coded badge shows current mode at a glance
- **Live subagent tracking** — see active subagents in real time as Claude spawns them; last 5 completed stay visible
- **Slash command palette** — type `/` to autocomplete any Claude Code slash command; `/model` swaps models mid-session while preserving history
- **Input history ring** — navigate your last 5 sent messages with arrow keys
- **Message queue** — send messages while Claude is thinking; they're held and drained automatically
- **Per-directory project commands** — configure `run`, `test`, and `build` commands per repo; run them with one click and see the last 15 lines of output in a toast
- **Caffeinate integration** — prevents macOS sleep while a session is active
- **Context bar** — visual 1M token window usage indicator; turns red above 80%

---

## Getting it

### Buy the prebuilt app — $4.99

Download a prebuilt `.dmg` from the [releases page](https://github.com/r0k3tkutt3r/jetstream/releases). Drag to Applications, launch, done.

> **Note:** The app is not notarized. On first launch, right-click the app and choose **Open** to bypass Gatekeeper.

### Build it yourself — free

Jetstream is open source. If you have the Rust and Node toolchain, you can compile and run it yourself at no cost.

**Prerequisites:**
- Rust (stable)
- Node.js + pnpm
- Tauri CLI v2 (`cargo install tauri-cli`)
- The `claude` CLI installed and authenticated

```bash
git clone https://github.com/r0k3tkutt3r/jetstream
cd jetstream
cargo tauri build
```

The compiled `.app` will be in `src-tauri/target/release/bundle/macos/`.

---

## Dev setup

```bash
# Install frontend dependencies
cd ui && pnpm install && cd ..

# Start the hot-reload dev build (backend + frontend)
cargo tauri dev
```

Set `CCSHELL_CLAUDE_BIN=/path/to/claude` to override the auto-detected claude binary.

Set `RUST_LOG=debug` to see stderr from spawned claude processes.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Cmd+N | New session |
| Cmd+O | Pick working directory |
| Cmd+B | Toggle left pane |
| Cmd+J | Toggle right pane |
| Cmd+1–9 | Switch to session by index |
| Cmd+, | Open settings |
| Shift+Tab | Cycle permission mode |
| Enter | Send message |
| Shift+Enter | Insert newline |
| ↑ / ↓ | Navigate input history |

---

## Requirements

- macOS (Apple Silicon or Intel)
- `claude` CLI installed — get it at [claude.ai/code](https://claude.ai/code)
- An active Claude.ai or Anthropic API subscription

---

## Stack

Rust + Tauri v2 backend, SolidJS + TypeScript frontend, Tokio async runtime. Session state persisted to `~/Library/Application Support/Jetstream/state.json`. Transcripts are standard `.jsonl` files in `~/.claude/projects/`.

---

## License

MIT
