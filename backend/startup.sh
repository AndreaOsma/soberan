#!/bin/sh
set -e

# Arranca como root solo para que «app» (uid 10001) pueda escribir en /data y baja de privilegios.
# Self-host con Docker: el volumen llega como root (y las bases de datos de antes, creadas por root) → chown.
# Homelab: /data es el montaje FUSE de LiteFS, que ya deja escribir a cualquiera y no admite chown → se deja.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  case "$(stat -f -c %T /data 2>/dev/null)" in
    fuse*) ;;
    *) chown -R app:app /data ;;
  esac
  exec setpriv --reuid=app --regid=app --init-groups --no-new-privs "$0" "$@"
fi

# Schema: FastAPI import runs create_all + Alembic (see app.main).
PORT="${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
