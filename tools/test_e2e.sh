#!/usr/bin/env bash
# Docs: docs/02 - Tech/Testing.md
# Purpose: runs the end-to-end test in Playwright's Docker image, because this machine's browser lacks system libraries.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$(mktemp -d)}"
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e OUT=/out -v "$ROOT:$ROOT" -v "$OUT:/out" -w "$ROOT" mcr.microsoft.com/playwright:v1.64.1-noble node ${E2E:-tests/e2e/run.mjs}
echo "Screenshots: $OUT"
