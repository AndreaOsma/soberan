#!/usr/bin/env bash
# Build Soberan Windows desktop installer on Linux CI (Docker).
# Frontend: run in the job (node). PyInstaller/Inno: tar in, docker cp out.
set -euo pipefail

VERSION="${1:?Usage: build-desktop-ci.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$ROOT/backend"
STATIC="$BACKEND/desktop/static"
DIST="$BACKEND/dist/Soberan"
INSTALLER_OUT="$ROOT/packaging/out"

PYINSTALLER_IMAGE="${PYINSTALLER_IMAGE:-batonogov/pyinstaller-windows:v5.0.0}"
INNO_IMAGE="${INNO_IMAGE:-amake/innosetup:latest}"

cleanup_containers() {
  for c in "${PYI_CONTAINER:-}" "${INNO_CONTAINER:-}"; do
    [[ -n "$c" ]] && docker rm -f "$c" >/dev/null 2>&1 || true
  done
}
trap cleanup_containers EXIT

echo "==> Soberan desktop CI build v${VERSION}"

if [[ "${SKIP_FRONTEND_BUILD:-}" != "1" ]]; then
  echo "==> Frontend"
  if [[ ! -f "$ROOT/package-lock.json" ]]; then
    echo "package-lock.json missing in checkout: $ROOT" >&2
    ls -la "$ROOT" >&2 || true
    exit 1
  fi
  (cd "$ROOT" && npm ci && npm run build)
fi

if [[ ! -f "$ROOT/dist/index.html" ]]; then
  echo "dist/ missing — run npm run build first" >&2
  exit 1
fi

echo "==> Static assets + VERSION"
mkdir -p "$STATIC" "$BACKEND/desktop"
find "$STATIC" -mindepth 1 -delete 2>/dev/null || true
cp -r "$ROOT/dist/"* "$STATIC/"
printf '%s' "$VERSION" > "$BACKEND/desktop/VERSION"

echo "==> PyInstaller (Wine via ${PYINSTALLER_IMAGE})"
rm -rf "$BACKEND/dist" "$BACKEND/build"
PYI_CONTAINER="soberan-pyi-${RANDOM}"
tar -cC "$BACKEND" . | docker run --name "$PYI_CONTAINER" -i \
  -e SRCDIR=/src \
  "${PYINSTALLER_IMAGE}" \
  "tar -xf - && pip install -r requirements-desktop.txt >&2 && pyinstaller --noconfirm soberan-desktop.spec >&2"
docker cp "${PYI_CONTAINER}:/src/dist" "$BACKEND/dist"
docker rm -f "$PYI_CONTAINER" >/dev/null
PYI_CONTAINER=""

if [[ -d "$BACKEND/dist/windows/Soberan" ]]; then
  rm -rf "$DIST"
  mv "$BACKEND/dist/windows/Soberan" "$DIST"
elif [[ ! -d "$DIST" ]]; then
  echo "PyInstaller output not found. dist contents:" >&2
  find "$BACKEND/dist" -maxdepth 3 -type f 2>/dev/null | head -40 >&2 || true
  exit 1
fi

if [[ ! -f "$DIST/Soberan.exe" ]]; then
  echo "Soberan.exe missing under $DIST" >&2
  exit 1
fi
echo "    Bundle: $DIST ($(du -sh "$DIST" | cut -f1))"

echo "==> Inno Setup (${INNO_IMAGE})"
mkdir -p "$INSTALLER_OUT"
rm -f "$INSTALLER_OUT/SoberanSetup-${VERSION}.exe"
INNO_CONTAINER="soberan-inno-${RANDOM}"
tar -cC "$ROOT" packaging backend/dist | docker run --name "$INNO_CONTAINER" -i --entrypoint sh "${INNO_IMAGE}" \
  -c "tar -xf - -C /work && iscc /DAppVersion=${VERSION} /work/packaging/soberan.iss >&2"
docker cp "${INNO_CONTAINER}:/work/packaging/out/SoberanSetup-${VERSION}.exe" "$INSTALLER_OUT/"
docker rm -f "$INNO_CONTAINER" >/dev/null
INNO_CONTAINER=""

INSTALLER="$INSTALLER_OUT/SoberanSetup-${VERSION}.exe"
if [[ ! -f "$INSTALLER" ]]; then
  echo "Installer missing: $INSTALLER" >&2
  ls -la "$INSTALLER_OUT" >&2 || true
  exit 1
fi

echo "==> Installer: $INSTALLER ($(wc -c < "$INSTALLER") bytes)"
