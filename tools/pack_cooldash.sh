#!/usr/bin/env bash
# Docs: docs/02 - Tech/Packaging.md
# Purpose: builds dist/ext (the extension) and dist/dholphin-<version>.cdpkg, CoolDash's package.
# PACK_WITH_KEYS=1 bundles TMDB_API_KEY and OMDB_API_KEY from .env, for your own TV only. Never share that package.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
tools/build_web.sh
VERSION="$(cut -d+ -f1 VERSION)"; EXT_ID="$(cat hosts/cooldash/ext/ID)"
rm -rf dist; mkdir -p dist/ext dist/pkg
cp -r web/dist/. dist/ext/
cp hosts/cooldash/ext/manifest.json hosts/cooldash/ext/background.js hosts/cooldash/ext/netflix.js hosts/cooldash/ext/rules.json dist/ext/
sed -i "s/\"version\": \"0.0.0\"/\"version\": \"$VERSION\"/" dist/ext/manifest.json
if [ "${PACK_WITH_KEYS:-0}" = 1 ]; then
  set -a; . ./.env; set +a
  printf '{"keys":{"tmdb":"%s","omdb":"%s"}}\n' "${TMDB_API_KEY:?}" "${OMDB_API_KEY:-}" > dist/ext/config.json
  echo "Keys bundled: keep this package to yourself"
fi
sed "s/@@VERSION@@/$VERSION/" packaging/cooldash/cooldash.template.json > dist/pkg/cooldash.json
cp brand/logo/png/cooldash-icon.png dist/pkg/icon.png
cp brand/logo/png/cooldash-banner.png dist/pkg/banner.png
# ARM only: CoolDash's PC image has no Chromium, so a PC listing could only fail to start.
for cpu in aarch64; do
  mkdir -p "dist/pkg/native/$cpu"
  sed "s/@@EXT_ID@@/$EXT_ID/" packaging/cooldash/launch > "dist/pkg/native/$cpu/launch"
  chmod +x "dist/pkg/native/$cpu/launch"
  cp -r dist/ext "dist/pkg/native/$cpu/ext"
done
(cd dist/pkg && rm -f "../dholphin-$VERSION.cdpkg" && python3 -c "
import os,sys,zipfile
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:
    for d,_,fs in os.walk('.'):
        for f in fs: z.write(os.path.join(d,f),os.path.relpath(os.path.join(d,f),'.'))
" "../dholphin-$VERSION.cdpkg")
ls -la "dist/dholphin-$VERSION.cdpkg"
