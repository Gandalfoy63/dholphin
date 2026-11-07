#!/usr/bin/env bash
# Docs: docs/02 - Tech/Stack.md
# Purpose: builds everything the page needs into web/dist.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
tools/build_wasm.sh >/dev/null
node tools/prepare_web.mjs
cp web/styles.css web/public/styles.css
npx vite build --logLevel warn
du -sh web/dist
