#!/bin/sh
set -e

# Schema: FastAPI import runs create_all + Alembic (see app.main).
PORT="${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
