#!/usr/bin/env bash
# Docs: docs/02 - Tech/Android App.md
# Purpose: builds the signed Android TV APK into dist/android/dholphin-<version>.apk. Never bundles keys.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
VERSION="$(cat VERSION)"
if [ ! -f "$HOME/.config/dholphin/signing.properties" ]; then
  echo "No release key: ~/.config/dholphin/signing.properties is missing. Updates must be signed with the same key." >&2
  exit 1
fi
tools/build_web.sh >/dev/null
rm -f web/dist/config.json
[ -f android/local.properties ] || echo "sdk.dir=${ANDROID_HOME:-$HOME/Android/Sdk}" > android/local.properties
(cd android && ./gradlew --quiet assembleRelease)
mkdir -p dist/android
OUT="dist/android/dholphin-${VERSION}.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
# No key may travel in the APK: each value in .env is looked for, as tools/publish_official.sh does.
if [ -f .env ]; then
  while IFS='=' read -r _ value; do
    [ -n "$value" ] || continue
    if unzip -p "$OUT" | grep -aqF "$value"; then echo "A key from .env is inside the APK: refusing" >&2; rm -f "$OUT"; exit 1; fi
  done < .env
fi
echo "$OUT ($(du -h "$OUT" | cut -f1))"
