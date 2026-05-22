#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Frontend build"
pnpm --dir ui install --frozen-lockfile
pnpm --dir ui build

echo "==> Tauri bundle"
cargo tauri build --bundles app,dmg

echo "==> Output:"
find target/release/bundle -maxdepth 3 -name "*.app" -o -name "*.dmg"
