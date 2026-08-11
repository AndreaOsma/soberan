#!/usr/bin/env bash
# Debug/emulator Android network config (cleartext + user CAs).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/android"
MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
SRC_XML="$ROOT/deploy/android-debug-res/xml/network_security_config.xml"
DEST_XML="$ANDROID_DIR/app/src/main/res/xml/network_security_config.xml"

if [[ ! -f "$MANIFEST" ]]; then
  echo "android manifest missing: $MANIFEST" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST_XML")"
cp "$SRC_XML" "$DEST_XML"

python3 - "$MANIFEST" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
if "networkSecurityConfig" not in text:
    text = text.replace(
        "<application",
        '<application\n        android:networkSecurityConfig="@xml/network_security_config"\n        android:usesCleartextTraffic="true"',
        1,
    )
path.write_text(text)
PY

echo "==> Android debug network config applied"
