#!/usr/bin/env bash
# Docs: docs/02 - Tech/Testing.md
# Purpose: runs the end-to-end tests in Playwright's Docker image, because this machine's browser lacks system libraries.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$(mktemp -d)}"
# The whole suite: the app, then the server behind a proxy. E2E=<script> runs one script instead.
if [ -n "${E2E:-}" ]; then RUN="node $E2E"; else RUN="node tests/e2e/run.mjs && node tests/e2e/behind-proxy.mjs"; fi
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e OUT=/out -v "$ROOT:$ROOT" -v "$OUT:/out" -w "$ROOT" mcr.microsoft.com/playwright:v1.64.1-noble \
  sh -c "$RUN"
echo "Screenshots: $OUT"
