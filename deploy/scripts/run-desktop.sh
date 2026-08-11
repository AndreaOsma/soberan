#!/usr/bin/env bash
# Dev helper: run Soberan desktop mode on macOS/Linux (no PyInstaller).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$ROOT/backend"
STATIC="$BACKEND/desktop/static"

echo "==> Building frontend..."
(cd "$ROOT" && npm run build)
rm -rf "$STATIC"/*
mkdir -p "$STATIC"
cp -r "$ROOT/dist/"* "$STATIC/"

echo "==> Starting desktop server..."
cd "$BACKEND"
export SOBERAN_DESKTOP=1
if [[ -x .venv/bin/python ]]; then
  PY=.venv/bin/python
else
  PY=python3
fi
exec "$PY" desktop_launcher.py "$@"
