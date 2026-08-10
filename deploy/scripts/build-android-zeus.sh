#!/usr/bin/env bash
# Build Soberan Android APK on zeus (native amd64 via Tailscale SSH).
# Usage: ./deploy/scripts/build-android-zeus.sh [version]
set -euo pipefail

VERSION="${1:-0.1.1}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE_HOST="${SOBERAN_ZEUS_HOST:-zeus}"
if [[ -z "${SOBERAN_ZEUS_BUILD_DIR:-}" ]]; then
  REMOTE_DIR="$(ssh "$REMOTE_HOST" 'printf %s "$HOME/soberan-android-src"')"
else
  REMOTE_DIR="$SOBERAN_ZEUS_BUILD_DIR"
fi
WS_VOL="${SOBERAN_ANDROID_WS_VOL:-soberan-android-ws}"
GRADLE_VOL="${SOBERAN_GRADLE_CACHE_VOL:-soberan-gradle-cache}"
NPM_VOL="${SOBERAN_NPM_CACHE_VOL:-soberan-npm-cache}"
IMAGE="${ANDROID_BUILD_IMAGE:-mingc/android-build-box:latest}"

echo "==> Building frontend locally"
cd "$ROOT"
if [[ "${SOBERAN_ANDROID_EMULATOR:-}" == "1" ]]; then
  export CAP_REMOTE_URL="${CAP_REMOTE_URL:-http://10.0.2.2:8080/}"
  npm run build
else
  npm run build
fi

echo "==> Syncing sources to ${REMOTE_HOST}:${REMOTE_DIR}"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR' '$REMOTE_DIR/packaging/out'"
rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude android \
  --exclude 'android/app/build' \
  --exclude 'android/.gradle' \
  --exclude packaging/out \
  "$ROOT/" "${REMOTE_HOST}:${REMOTE_DIR}/"

echo "==> Building APK on zeus (native amd64)"
ssh "$REMOTE_HOST" bash -s <<EOF
set -euo pipefail
docker volume create "$WS_VOL" >/dev/null
docker volume create "$GRADLE_VOL" >/dev/null
docker volume create "$NPM_VOL" >/dev/null
docker pull "$IMAGE" >/dev/null

if ! docker run --rm -v "$WS_VOL":/project "$IMAGE" test -d /project/android; then
  echo "Seeding workspace volume on zeus..."
  tar -cC "$REMOTE_DIR" . | docker run --rm -i \
    -v "$WS_VOL":/project \
    "$IMAGE" bash -lc 'mkdir -p /project && tar -xf - -C /project'
else
  echo "Updating web assets in workspace..."
  tar -cC "$REMOTE_DIR" dist assets deploy/android-launcher-res deploy/android-debug-res capacitor.config.ts package.json package-lock.json deploy | docker run --rm -i \
    -v "$WS_VOL":/project \
    "$IMAGE" bash -lc 'tar -xf - -C /project'
fi

docker run --rm \
  -e SOBERAN_ANDROID_EMULATOR="${SOBERAN_ANDROID_EMULATOR:-}" \
  -e SOBERAN_ANDROID_BUNDLED="${SOBERAN_ANDROID_BUNDLED:-}" \
  -e CAP_REMOTE_URL="${CAP_REMOTE_URL:-}" \
  -e VITE_API_BASE_URL="${VITE_API_BASE_URL:-}" \
  -v "$WS_VOL":/project \
  -v "$GRADLE_VOL":/root/.gradle \
  -v "$NPM_VOL":/root/.npm \
  -w /project \
  "$IMAGE" \
  bash -lc 'chmod +x deploy/scripts/build-android-ci.sh && SKIP_FRONTEND_BUILD=1 GRADLE_NO_DAEMON=0 ./deploy/scripts/build-android-ci.sh $(printf %q "$VERSION")'

CID="soberan-apk-extract-\$\$"
docker create --name "\$CID" -v "$WS_VOL":/project "$IMAGE" >/dev/null
docker cp "\$CID":/project/packaging/out/. "$REMOTE_DIR/packaging/out/"
docker rm -f "\$CID" >/dev/null
ls -lah "$REMOTE_DIR/packaging/out"/Soberan-*.apk
EOF

mkdir -p "$ROOT/packaging/out"
rsync -az "${REMOTE_HOST}:${REMOTE_DIR}/packaging/out/" "$ROOT/packaging/out/"
echo "==> APK local: $ROOT/packaging/out/"
ls -lah "$ROOT/packaging/out"/Soberan-*.apk
