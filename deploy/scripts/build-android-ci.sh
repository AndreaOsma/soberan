#!/usr/bin/env bash
# Build Soberan Android APK on CI (Capacitor + Gradle).
# Default: remote URL shell (CAP_REMOTE_URL) — avoids CORS with a split frontend/API host.
# Override CAP_REMOTE_URL="" and set VITE_API_BASE_URL for a fully bundled client.
set -euo pipefail

VERSION="${1:?Usage: build-android-ci.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT/packaging/out"
ANDROID_DIR="$ROOT/android"

if [[ "${SOBERAN_ANDROID_EMULATOR:-}" == "1" ]]; then
  CAP_REMOTE_URL="${CAP_REMOTE_URL:-http://10.0.2.2:8080/}"
fi

if [[ "${SOBERAN_ANDROID_BUNDLED:-}" == "1" ]]; then
  CAP_REMOTE_URL=""
elif [[ -z "${CAP_REMOTE_URL:-}" ]]; then
  CAP_REMOTE_URL="https://soberan.andreaosma.com/"
fi
export CAP_REMOTE_URL CAP_APP_ID="${CAP_APP_ID:-com.andreaosma.soberan}" CAP_APP_NAME="${CAP_APP_NAME:-Soberan}"

echo "==> Soberan Android CI build v${VERSION}"
if [[ "${SOBERAN_ANDROID_EMULATOR:-}" == "1" && -n "$CAP_REMOTE_URL" ]]; then
  echo "    Mode: emulator shell → ${CAP_REMOTE_URL}"
elif [[ "${SOBERAN_ANDROID_EMULATOR:-}" == "1" ]]; then
  echo "    Mode: emulator (bundled UI + cleartext API)"
  echo "    API: ${VITE_API_BASE_URL:-http://10.0.2.2:8080/api}"
elif [[ -n "$CAP_REMOTE_URL" ]]; then
  echo "    Mode: remote shell → ${CAP_REMOTE_URL}"
else
  export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://soberan.andreaosma.com/api}"
  echo "    Mode: bundled client → API ${VITE_API_BASE_URL}"
fi

cd "$ROOT"

if [[ ! -f package-lock.json ]]; then
  echo "package-lock.json missing in checkout: $ROOT" >&2
  exit 1
fi

if [[ "${SKIP_FRONTEND_BUILD:-}" != "1" ]]; then
  npm ci
  npm run build
elif [[ ! -d node_modules ]] || [[ ! -f node_modules/.soberan-lock-hash ]] || [[ "$(cat node_modules/.soberan-lock-hash 2>/dev/null)" != "$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}' || shasum -a 256 package-lock.json | awk '{print $1}')" ]] || [[ ! -x node_modules/.bin/tsc ]]; then
  npm ci --include=dev --ignore-scripts
  sha256sum package-lock.json 2>/dev/null | awk '{print $1}' > node_modules/.soberan-lock-hash || shasum -a 256 package-lock.json | awk '{print $1}' > node_modules/.soberan-lock-hash
fi

if [[ ! -f "$ROOT/dist/index.html" ]]; then
  echo "dist/ missing — run npm run build first" >&2
  exit 1
fi

if [[ ! -d "$ANDROID_DIR" ]]; then
  npx cap add android
fi

chmod +x deploy/scripts/generate-android-icons.sh
./deploy/scripts/generate-android-icons.sh

npx cap sync android

if [[ "${SOBERAN_ANDROID_EMULATOR:-}" == "1" ]]; then
  chmod +x deploy/scripts/apply-android-debug-config.sh
  ./deploy/scripts/apply-android-debug-config.sh
fi

# Version labels for the generated APK/AAB filename / manifest.
if [[ -f "$ANDROID_DIR/app/build.gradle" ]]; then
  sed -i.bak -E "s/versionName \"[^\"]*\"/versionName \"${VERSION}\"/" "$ANDROID_DIR/app/build.gradle"
  # Play Store requires versionCode to strictly increase on every upload — derive it from
  # semver (X.Y.Z -> X*1_000_000 + Y*1_000 + Z) so it moves in lockstep with versionName
  # instead of staying hardcoded. Leaves versionCode untouched for non-semver versions
  # (e.g. desktop-style build numbers) rather than guessing.
  if [[ "$VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    VERSION_CODE=$(( ${BASH_REMATCH[1]} * 1000000 + ${BASH_REMATCH[2]} * 1000 + ${BASH_REMATCH[3]} ))
    sed -i.bak -E "s/versionCode [0-9]+/versionCode ${VERSION_CODE}/" "$ANDROID_DIR/app/build.gradle"
    echo "    versionCode: ${VERSION_CODE} (from ${VERSION})"
  else
    echo "    versionCode: left as-is (VERSION '${VERSION}' isn't X.Y.Z semver)"
  fi
  rm -f "$ANDROID_DIR/app/build.gradle.bak"
fi

SIGN_RELEASE=false
KEYSTORE_PATH="$ANDROID_DIR/release.keystore"
if [[ -n "${ANDROID_KEYSTORE_BASE64:-}" ]]; then
  echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$KEYSTORE_PATH"
  SIGN_RELEASE=true

  GRADLE_PROPS="$ANDROID_DIR/keystore.properties"
  cat > "$GRADLE_PROPS" <<EOF
storeFile=release.keystore
storePassword=${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD required with keystore}
keyAlias=${ANDROID_KEY_ALIAS:?ANDROID_KEY_ALIAS required with keystore}
keyPassword=${ANDROID_KEY_PASSWORD:-${ANDROID_KEYSTORE_PASSWORD}}
EOF

  BUILD_GRADLE="$ANDROID_DIR/app/build.gradle"
  if ! grep -q "keystore.properties" "$BUILD_GRADLE"; then
    python3 - "$BUILD_GRADLE" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
inject = """
def keystorePropsFile = rootProject.file("keystore.properties")
def keystoreProps = new Properties()
if (keystorePropsFile.exists()) {
    keystoreProps.load(new FileInputStream(keystorePropsFile))
}
"""
if "keystore.properties" not in text:
    text = text.replace("android {", inject + "\nandroid {", 1)
    signing = """
        signingConfigs {
            release {
                if (keystorePropsFile.exists()) {
                    storeFile file(keystoreProps['storeFile'])
                    storePassword keystoreProps['storePassword']
                    keyAlias keystoreProps['keyAlias']
                    keyPassword keystoreProps['keyPassword']
                }
            }
        }
"""
    text = text.replace("buildTypes {", signing + "\n        buildTypes {", 1)
    text = text.replace(
        "release {",
        "release {\n            signingConfig signingConfigs.release",
        1,
    )
    path.write_text(text)
PY
  fi
fi

cd "$ANDROID_DIR"
if [[ -d /usr/lib/jvm/java-21-openjdk-amd64 ]]; then
  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
fi

GRADLE_ARGS=(--parallel)
if [[ "${GRADLE_NO_DAEMON:-1}" == "1" ]]; then
  GRADLE_ARGS+=(--no-daemon)
fi

if [[ "$SIGN_RELEASE" == "true" ]]; then
  ./gradlew assembleRelease bundleRelease "${GRADLE_ARGS[@]}"
  APK="$(find app/build/outputs/apk/release -name '*.apk' -type f | head -1)"
  OUT_NAME="Soberan-${VERSION}.apk"
  AAB="$(find app/build/outputs/bundle/release -name '*.aab' -type f | head -1)"
  if [[ -z "$AAB" || ! -f "$AAB" ]]; then
    echo "AAB not found after Gradle build (needed for Play Store uploads)" >&2
    find app/build/outputs/bundle -name '*.aab' 2>/dev/null | head -20 >&2 || true
    exit 1
  fi
  mkdir -p "$OUT_DIR"
  AAB_DEST="$OUT_DIR/Soberan-${VERSION}.aab"
  cp "$AAB" "$AAB_DEST"
  echo "==> AAB: $AAB_DEST ($(wc -c < "$AAB_DEST") bytes)"
else
  ./gradlew assembleDebug "${GRADLE_ARGS[@]}"
  APK="$(find app/build/outputs/apk/debug -name '*.apk' -type f | head -1)"
  if [[ "${SOBERAN_ANDROID_EMULATOR:-}" == "1" ]]; then
    OUT_NAME="Soberan-${VERSION}-emulator-debug.apk"
  else
    OUT_NAME="Soberan-${VERSION}-debug.apk"
  fi
fi

if [[ -z "$APK" || ! -f "$APK" ]]; then
  echo "APK not found after Gradle build" >&2
  find app/build/outputs -name '*.apk' 2>/dev/null | head -20 >&2 || true
  exit 1
fi

mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/$OUT_NAME"
cp "$APK" "$DEST"
echo "==> APK: $DEST ($(wc -c < "$DEST") bytes)"
