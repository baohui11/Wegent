#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE_ROOT="$ROOT/vendor/frontend-fonts"
SOURCE_FONTS="$BUNDLE_ROOT/public/fonts"
SOURCE_CSS="$BUNDLE_ROOT/src/app/google-sans-local.css"
DEST_FONTS="$ROOT/frontend/public/fonts"
DEST_CSS="$ROOT/frontend/src/app/google-sans-local.css"

if [[ ! -d "$SOURCE_FONTS" ]]; then
  echo "Missing bundle: $SOURCE_FONTS. Upload vendor/frontend-fonts first." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_FONTS/SourceHanSansSC-VF.ttf" ]]; then
  echo "Missing PDF font in bundle." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_CSS" ]]; then
  echo "Missing CSS in bundle: $SOURCE_CSS" >&2
  exit 1
fi

mkdir -p "$DEST_FONTS"
cp -R "$SOURCE_FONTS"/. "$DEST_FONTS/"
cp "$SOURCE_CSS" "$DEST_CSS"
echo "Done. Fonts installed under frontend/public/fonts."
