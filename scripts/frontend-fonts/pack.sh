#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_FONTS="$ROOT/frontend/public/fonts"
SOURCE_CSS="$ROOT/frontend/src/app/google-sans-local.css"
BUNDLE_ROOT="$ROOT/vendor/frontend-fonts"
DEST_FONTS="$BUNDLE_ROOT/public/fonts"
DEST_CSS_DIR="$BUNDLE_ROOT/src/app"

if [[ ! -d "$SOURCE_FONTS" ]]; then
  echo "Missing $SOURCE_FONTS. Run: cd frontend && npm run download-fonts" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_FONTS/SourceHanSansSC-VF.ttf" ]]; then
  echo "Missing PDF font: $SOURCE_FONTS/SourceHanSansSC-VF.ttf" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_FONTS/google-sans" ]]; then
  echo "Missing UI fonts: $SOURCE_FONTS/google-sans" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_CSS" ]]; then
  echo "Missing $SOURCE_CSS. Run: cd frontend && npm run download-fonts" >&2
  exit 1
fi

mkdir -p "$DEST_FONTS" "$DEST_CSS_DIR"
rm -rf "${DEST_FONTS:?}/"*
cp -R "$SOURCE_FONTS"/. "$DEST_FONTS/"
cp "$SOURCE_CSS" "$DEST_CSS_DIR/google-sans-local.css"
echo "Done. Upload vendor/frontend-fonts/ to the intranet."
