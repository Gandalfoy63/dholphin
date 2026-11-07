#!/usr/bin/env bash
# Docs: docs/04 - Architecture/Rust Core.md
# Purpose: compiles the Rust core to WebAssembly for the page.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
cd "$ROOT"
cargo build -p dholphin-core --release --target wasm32-unknown-unknown --lib
mkdir -p web/public
cp target/wasm32-unknown-unknown/release/dholphin_core.wasm web/public/dholphin_core.wasm
ls -la web/public/dholphin_core.wasm
