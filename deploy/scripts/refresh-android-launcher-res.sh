#!/usr/bin/env bash
# Regenerate deploy/android-launcher-res from assets/icon.png (macOS: uses @capacitor/assets + sharp).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Run on macOS after updating assets/icon.png (deploy/scripts/render-app-icon-macos.sh)." >&2
  exit 1
fi

if [[ ! -d android ]]; then
  npx cap add android
fi

npx capacitor-assets generate \
  --android \
  --assetPath assets \
  --iconBackgroundColor "#0f1a2e" \
  --splashBackgroundColor "#0f1a2e"

DEST="$ROOT/deploy/android-launcher-res"
rm -rf "$DEST"
mkdir -p "$DEST"
for item in mipmap-ldpi mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi mipmap-anydpi-v26 values; do
  cp -R "$ROOT/android/app/src/main/res/$item" "$DEST/"
done
cp "$ROOT/android/app/src/main/res/drawable/ic_launcher_background.xml" "$DEST/drawable-ic_launcher_background.xml"
cp "$ROOT/android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml" "$DEST/drawable-v24-ic_launcher_foreground.xml"

echo "==> Updated $DEST"
