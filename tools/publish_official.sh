#!/usr/bin/env bash
# Docs: docs/02 - Tech/Packaging.md
# Purpose: publishes the committed version to the public CoolDash marketplace as an official item. Live at once, no review.
#   tools/publish_official.sh "What changed" [--container cooldash-cloud-1]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
CHANGELOG="${1:?usage: tools/publish_official.sh \"What changed\" [--container name]}"
C=cooldash-cloud-1; [ "${2:-}" = --container ] && C="$3"
[ -z "$(git status --porcelain)" ] || { echo "Commit first: what is published must match a commit"; exit 1; }
PACK_WITH_KEYS=0 tools/pack_cooldash.sh >/dev/null
V="$(cut -d+ -f1 VERSION)"; PKG="dist/dholphin-$V.cdpkg"
[ ! -e dist/pkg/native/aarch64/ext/config.json ] || { echo "Refusing: this package holds a config.json"; exit 1; }
if [ -f .env ]; then
  while IFS='=' read -r _ value; do
    [ -n "$value" ] || continue
    if unzip -p "$PKG" | grep -aqF "$value"; then echo "Refusing: a key from .env is inside the package"; exit 1; fi
  done < .env
fi
(cd dist/pkg && node "${COOLDASH_CLI:-$HOME/Projects/cooldash/packages/cli/dist/cli.js}" validate .)
docker cp "$PKG" "$C:/tmp/dholphin-$V.cdpkg"
docker exec "$C" node dist/publish-official.js "/tmp/dholphin-$V.cdpkg" --changelog "$CHANGELOG"
docker exec -u 0 "$C" rm -f "/tmp/dholphin-$V.cdpkg"
