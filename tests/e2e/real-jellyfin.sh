#!/usr/bin/env bash
# Docs: docs/02 - Tech/Testing.md
# Purpose: tests the app against a real Jellyfin server in Docker: sign-in, library, playback, tracks, progress reports.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$(mktemp -d)}"; J=http://localhost:18097; C=dholphin-jellyfin-test
mkdir -p "$OUT"/{config,cache,media/Movies}
docker rm -f $C >/dev/null 2>&1 || true
trap 'docker rm -f $C >/dev/null 2>&1 || true' EXIT
docker run -d --name $C -u "$(id -u):$(id -g)" -p 18097:8096 -v "$OUT/config:/config" -v "$OUT/cache:/cache" -v "$OUT/media:/media" jellyfin/jellyfin:latest >/dev/null
# Six minutes: Jellyfin keeps no resume point for films under five.
# Two audio tracks, English then French, and an English subtitle file beside it: the player's track choices.
docker exec $C /usr/lib/jellyfin-ffmpeg/ffmpeg -loglevel error -y -f lavfi -i testsrc=size=320x180:rate=10 -f lavfi -i sine=frequency=440 -f lavfi -i sine=frequency=880 -t 360 -map 0 -map 1 -map 2 -c:v libvpx -b:v 60k -deadline realtime -c:a libopus -b:a 32k -metadata:s:a:0 language=eng -metadata:s:a:1 language=fre "/media/Movies/Dholphin Test Film (2024).webm"
node -e 'let s="";for(let i=0;i<120;i++){const t=(n)=>new Date(n*1000).toISOString().slice(11,19)+",000";s+=`${i+1}\n${t(i*3)} --> ${t(i*3+3)}\nSubtitle line ${i+1}\n\n`}process.stdout.write(s)' > "$OUT/media/Movies/Dholphin Test Film (2024).en.srt"
for _ in $(seq 90); do curl -sf $J/System/Info/Public >/dev/null && break; sleep 2; done
A='MediaBrowser Client="setup", Device="setup", DeviceId="setup1", Version="1"'
post() { curl -sf -X POST "$J$1" -H "Authorization: $2" -H 'Content-Type: application/json' -d "$3"; }
for _ in $(seq 30); do post /Startup/Configuration "$A" '{"ServerName":"Test","UICulture":"en-US","MetadataCountryCode":"US","PreferredMetadataLanguage":"en"}' && break; sleep 2; done
curl -sf $J/Startup/User -H "Authorization: $A" >/dev/null || true
post /Startup/User "$A" '{"Name":"alice","Password":"pw123"}'
curl -sf -X POST $J/Startup/Complete -H "Authorization: $A"
TOK=$(post /Users/AuthenticateByName "$A" '{"Username":"alice","Pw":"pw123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).AccessToken')
AT="$A, Token=\"$TOK\""
post "/Library/VirtualFolders?name=Movies&collectionType=movies&paths=/media/Movies&refreshLibrary=true" "$AT" '{"LibraryOptions":{}}'
ME=$(curl -sf $J/Users/Me -H "Authorization: $AT" | node -pe 'JSON.parse(require("fs").readFileSync(0)).Id')
FOUND=0
for _ in $(seq 60); do
  curl -sf -X POST $J/Library/Refresh -H "Authorization: $AT" >/dev/null || true
  sleep 3
  FOUND=$(curl -sf "$J/Items?userId=$ME&recursive=true&includeItemTypes=Movie" -H "Authorization: $AT" | node -pe 'JSON.parse(require("fs").readFileSync(0)).TotalRecordCount')
  [ "$FOUND" -ge 1 ] && break
done
[ "$FOUND" -ge 1 ] || { echo "The server never found the test film"; docker logs --tail 20 $C; exit 1; }
echo "Server library has $FOUND film(s)"
docker run --rm --network host -u "$(id -u):$(id -g)" -e HOME=/tmp -e OUT=/out -e JELLYFIN=$J -e JELLYFIN_TOKEN="$TOK" -v "$ROOT:$ROOT" -v "$OUT:/out" -w "$ROOT" mcr.microsoft.com/playwright:v1.64.1-noble node tests/e2e/real-jellyfin.mjs
