#!/usr/bin/env bash
# Local Android build using Docker named volumes (bind mounts break on this macOS setup).
# First run: slow (SDK/Gradle + cap add). Later runs: much faster (cached android + gradle).
set -euo pipefail

VERSION="${1:-0.1.1}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGING="/tmp/soberan-android-staging"
WS_VOL="${SOBERAN_ANDROID_WS_VOL:-soberan-android-ws}"
GRADLE_VOL="${SOBERAN_GRADLE_CACHE_VOL:-soberan-gradle-cache}"
NPM_VOL="${SOBERAN_NPM_CACHE_VOL:-soberan-npm-cache}"
IMAGE="${ANDROID_BUILD_IMAGE:-mingc/android-build-box:latest}"

echo "==> Soberan Android local build v${VERSION}"
echo "    Docker volumes: $WS_VOL, $GRADLE_VOL, $NPM_VOL"

cd "$ROOT"
npm run build

mkdir -p "$STAGING" "$ROOT/packaging/out"
rsync -a --delete \
  --exclude .git \
  --exclude packaging/out \
  --exclude 'android/app/build' \
  --exclude 'android/.gradle' \
  --exclude node_modules \
  "$ROOT/" "$STAGING/"

docker volume create "$WS_VOL" >/dev/null
docker volume create "$GRADLE_VOL" >/dev/null
docker volume create "$NPM_VOL" >/dev/null

# Seed workspace volume on first run (or when android project missing).
if ! docker run --rm --platform linux/amd64 -v "$WS_VOL":/project "$IMAGE" test -d /project/android; then
  echo "==> First run: seeding workspace volume (slow once)..."
  COPYFILE_DISABLE=1 tar -cC "$STAGING" . 2>/dev/null | docker run --rm -i --platform linux/amd64 \
    -v "$WS_VOL":/project \
    "$IMAGE" bash -lc 'mkdir -p /project && tar -xf - -C /project'
else
  echo "==> Updating changed web assets in workspace..."
  COPYFILE_DISABLE=1 tar -cC "$STAGING" dist capacitor.config.ts package.json package-lock.json deploy 2>/dev/null | docker run --rm -i --platform linux/amd64 \
    -v "$WS_VOL":/project \
    "$IMAGE" bash -lc 'tar -xf - -C /project'
fi

docker run --rm --platform linux/amd64 \
  -v "$WS_VOL":/project \
  -v "$GRADLE_VOL":/root/.gradle \
  -v "$NPM_VOL":/root/.npm \
  -w /project \
  "$IMAGE" \
  bash -lc 'chmod +x deploy/scripts/build-android-ci.sh && SKIP_FRONTEND_BUILD=1 GRADLE_NO_DAEMON=0 ./deploy/scripts/build-android-ci.sh '"$(printf '%q' "$VERSION")"

CID="soberan-apk-extract-$$"
docker create --name "$CID" -v "$WS_VOL":/project "$IMAGE" >/dev/null
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
docker cp "$CID":/project/packaging/out/. "$ROOT/packaging/out/"
ls -lah "$ROOT/packaging/out"/Soberan-*.apk
