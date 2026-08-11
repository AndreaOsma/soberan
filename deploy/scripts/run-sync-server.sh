#!/usr/bin/env bash
# Run Soberan as a dedicated sync server (no desktop mode).
# Exposes /sync/server/push and /sync/server/pull for native clients.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

ENV_FILE="${SOBERAN_SYNC_ENV_FILE:-$ROOT/deploy/sync-server.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

HOST="${SOBERAN_SYNC_HOST:-127.0.0.1}"
PORT="${SOBERAN_SYNC_PORT:-8787}"
STORAGE="${SOBERAN_SYNC_SERVER_STORAGE_DIR:-$ROOT/data/sync-server}"
TOKEN="${SOBERAN_SYNC_SERVER_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "SOBERAN_SYNC_SERVER_TOKEN is required." >&2
  echo "Example: SOBERAN_SYNC_SERVER_TOKEN='change-me' ./deploy/scripts/run-sync-server.sh" >&2
  exit 1
fi

mkdir -p "$STORAGE"
export SOBERAN_SYNC_SERVER_MODE=1
export SOBERAN_SYNC_SERVER_STORAGE_DIR="$STORAGE"
export DATABASE_URL="${DATABASE_URL:-sqlite:////${STORAGE}/soberan-sync-meta.db}"

echo "Starting sync server on http://${HOST}:${PORT}"
echo "Storage: ${SOBERAN_SYNC_SERVER_STORAGE_DIR}"

if command -v uvicorn >/dev/null 2>&1; then
  UVICORN=(uvicorn)
elif [[ -x "$ROOT/backend/.venv/bin/uvicorn" ]]; then
  UVICORN=("$ROOT/backend/.venv/bin/uvicorn")
elif [[ -x "$ROOT/.venv/bin/uvicorn" ]]; then
  UVICORN=("$ROOT/.venv/bin/uvicorn")
else
  echo "uvicorn not found (install backend requirements or activate venv)" >&2
  exit 1
fi

cd "$ROOT/backend"
exec "${UVICORN[@]}" app.main:app --host "$HOST" --port "$PORT"
