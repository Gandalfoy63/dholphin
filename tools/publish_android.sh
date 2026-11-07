#!/usr/bin/env bash
# Docs: docs/03 - Features/Updates.md
# Purpose: publishes the Android TV app: a GitHub release of the committed VERSION, which every installed app offers as an update.
# Run only when the owner says "publish". Usage: tools/publish_android.sh "What changed, in a few short lines"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
REPO="Gandalfoy63/dholphin-releases"
NOTES="${1:?Give the release notes: tools/publish_android.sh \"What changed\"}"
VERSION="$(cat VERSION)"
TAG="v${VERSION}"

# Only committed work is published, so a release always matches a commit.
if [ -n "$(git status --porcelain)" ]; then echo "Commit first: the tree has changes" >&2; exit 1; fi
if [ -f .env ]; then
  while IFS='=' read -r _ value; do
    [ -n "$value" ] || continue
    if git grep --cached -qF "$value"; then echo "A key from .env is committed: refusing" >&2; exit 1; fi
  done < .env
fi

# The releases repository holds only APKs and notes, never the source. Docs: GitHub CLI/gh repo create.
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --add-readme --description "Releases of Dholphin for Android TV. Install the APK from the latest release; the app then updates itself."
fi
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then echo "$TAG is already published: bump VERSION first" >&2; exit 1; fi

tools/build_android.sh
APK="dist/android/dholphin-${VERSION}.apk"
# Docs: GitHub CLI/gh release create. The app reads the latest release's tag, notes and .apk asset.
gh release create "$TAG" "$APK" --repo "$REPO" --title "Dholphin ${VERSION%%+*}" --notes "$NOTES" --latest
echo "Published $TAG: https://github.com/$REPO/releases/tag/$TAG"
