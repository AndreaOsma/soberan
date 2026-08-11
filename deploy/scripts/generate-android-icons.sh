#!/usr/bin/env bash
# Apply Android launcher icons (📊 on #0f1a2e — same as public/favicon.svg / Docker).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/deploy/android-launcher-res"
ANDROID_RES="$ROOT/android/app/src/main/res"

if [[ ! -d "$SRC" ]]; then
  echo "Missing $SRC" >&2
  exit 1
fi

if [[ ! -d "$ANDROID_RES" ]]; then
  echo "android/ missing — run 'npx cap add android' first" >&2
  exit 1
fi

for dir in mipmap-ldpi mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi mipmap-anydpi-v26 values; do
  rm -rf "$ANDROID_RES/$dir"
  cp -R "$SRC/$dir" "$ANDROID_RES/"
done

mkdir -p "$ANDROID_RES/drawable" "$ANDROID_RES/drawable-v24"
cp "$SRC/drawable-ic_launcher_background.xml" "$ANDROID_RES/drawable/ic_launcher_background.xml"
cp "$SRC/drawable-v24-ic_launcher_foreground.xml" "$ANDROID_RES/drawable-v24/ic_launcher_foreground.xml"

echo "==> Android launcher icons applied from deploy/android-launcher-res"
