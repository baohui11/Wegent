#!/usr/bin/env bash
# Extract vendor/frontend-fonts-bundle.zip then install into frontend/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVE="$ROOT/vendor/frontend-fonts-bundle.zip"
BUNDLE_ROOT="$ROOT/vendor/frontend-fonts"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Missing $ARCHIVE" >&2
  exit 1
fi

rm -rf "$BUNDLE_ROOT"
mkdir -p "$BUNDLE_ROOT"
unzip -q "$ARCHIVE" -d "$BUNDLE_ROOT"
bash "$(dirname "$0")/install.sh"
