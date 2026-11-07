#!/usr/bin/env bash
# Docs: docs/04 - Architecture/Server.md
# Purpose: builds the web app, then the Dholphin server image (dholphin:<version> and dholphin:latest).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
tools/pack_cooldash.sh >/dev/null
VERSION="$(tr -d '\n' < VERSION | tr '+' '-')"
docker build -f docker/Dockerfile -t "dholphin:$VERSION" -t dholphin:latest .
echo "Built dholphin:$VERSION"
