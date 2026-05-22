# CCShell

A Rust + Tauri AI terminal for Claude Code. One claude child per session, streamed JSONL to a custom three-pane GUI, agent-first.

## Quick start

```bash
# Rust core tests
cargo test

# Frontend tests
pnpm --dir ui test:run

# Dev (Vite + Tauri)
cargo tauri dev

# Release bundle
./scripts/build-macos.sh
```

## Architecture

See `docs/superpowers/specs/2026-05-21-ccshell-design.md`.

## Workspace

- `crates/core` — process supervisor, protocol parser, caffeinate, agents (no Tauri).
- `crates/app`  — Tauri shell, commands, state.json manifest.
- `ui/`         — SolidJS + TypeScript frontend.
- `tests/e2e`   — WebdriverIO smoke specs (manual run; requires a built .app and tauri-driver).

## Configuration

Override the claude binary path via env:

```bash
CCSHELL_CLAUDE_BIN=/path/to/claude cargo tauri dev
```
