#!/usr/bin/env bash
# Build a debug APK for Android emulator against local Docker on the host.
#
# Prereq on host: Soberan backend reachable at http://127.0.0.1:8080
#   cd deploy && docker compose up -d
#
# Emulator maps host loopback as 10.0.2.2
set -euo pipefail

VERSION="${1:-0.1.1}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export SOBERAN_ANDROID_EMULATOR=1
export CAP_REMOTE_URL="${CAP_REMOTE_URL:-http://10.0.2.2:8080/}"
unset SOBERAN_ANDROID_BUNDLED

echo "==> Emulator APK build"
echo "    Shell: ${CAP_REMOTE_URL}"
echo "    Host backend: docker compose -f deploy/docker-compose.yml up -d (port 8080)"

cd "$ROOT"
npm run build
SOBERAN_ANDROID_EMULATOR=1 CAP_REMOTE_URL="$CAP_REMOTE_URL" \
  exec "$ROOT/deploy/scripts/build-android-zeus.sh" "$VERSION"
