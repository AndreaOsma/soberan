# Single multi-stage Dockerfile for Soberan.
#
# Default (Docker Hub / Compose): all-in-one SPA + API on :8080
#   docker build -t soberan:local .
#
# Optional split images (API-only, or SPA behind your own reverse proxy):
#   docker build --target api -t soberan-api .
#   docker build --target frontend -t soberan-frontend .
#
# Build context: dev/ (one level above this app), NOT this app's own root —
# src/App.tsx imports shared code from ../../../lib/native-feel
# (dev/lib/, a sibling of dev/apps/soberan — see AGENTS.md's "librería de
# runtime compartida" section), and tsc needs those directories to actually
# exist on disk at build time (tsconfig.app.json's "include" lists them
# explicitly, not just an import path). A context scoped to this app alone
# can never reach them — confirmed broken since the native-feel import
# landed 2026-08-16, only surfaced 2026-09-22 when a new feature's CI run
# was the first to hit the frontend build step in a while. Local dev and
# vite's own dev server were never affected (both already run from inside
# the full monorepo checkout); this was purely a CI/Docker gap.
#
#   docker buildx build -f apps/soberan/Dockerfile <flags> dev/
#
# (dev/apps/soberan/Dockerfile itself, but context = dev/ — see
# .gitea/workflows/deploy-soberan.yml's "Build and push" step.)

# ---------------------------------------------------------------------------
# Frontend (Vite)
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build/apps/soberan
ENV NODE_ENV=development
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_AUDIT=false

COPY apps/soberan/package.json apps/soberan/package-lock.json ./
RUN npm ci \
  && test -x node_modules/.bin/tsc \
  && test -x node_modules/.bin/vite

COPY apps/soberan/index.html apps/soberan/vite.config.ts apps/soberan/tsconfig.json apps/soberan/tsconfig.app.json apps/soberan/tsconfig.node.json apps/soberan/eslint.config.js ./
COPY apps/soberan/public ./public
COPY apps/soberan/src ./src
# Absolute destination: lands at /build/lib/..., a sibling of /build/apps —
# mirrors dev/lib/'s position relative to dev/apps/soberan/ exactly, which
# is what makes the app's existing ../../../lib/... imports resolve.
COPY lib/native-feel /build/lib/native-feel
RUN npm run build

# ---------------------------------------------------------------------------
# API only (FastAPI + Uvicorn)
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS api
WORKDIR /app

# psycopg2-binary ships wheels — no build-essential/libpq-dev (avoids linux-libc-dev CVEs).
# CACHEBUST forces apt to re-run when Debian publishes security updates that Trivy
# would otherwise block on a stale buildx layer (seen 2026-10-01: openssl/pcre2).
ARG APT_CACHEBUST=2026-10-01
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends --only-upgrade \
       libssl3t64 openssl openssl-provider-legacy libpcre2-8-0 \
  && rm -rf /var/lib/apt/lists/* \
  && echo "apt-cachebust=${APT_CACHEBUST}" >/dev/null

COPY apps/soberan/backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip "setuptools>=83" "wheel>=0.46.2" \
  && pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir "jaraco.context>=6.1.0" \
  # PEP 770 / third-party SBOMs (e.g. from pip) list stale transitive pins that Trivy
  # then flags even when METADATA shows the upgraded packages (or packages not installed).
  && find /usr/local -type d -name sboms -prune -exec rm -rf {} + 2>/dev/null || true \
  && find /usr/local -type f \( -name '*.spdx.json' -o -name '*.cdx.json' -o -name 'sbom.json' \) -delete 2>/dev/null || true \
  && python -c "import setuptools; assert tuple(map(int, setuptools.__version__.split('.')[:2])) >= (83, 0), setuptools.__version__"

# native-sync va vendorizado en backend/app/native_sync/ (dev/lib/native-sync/sync.mjs).
COPY apps/soberan/backend/ .

# El bundle de la app de escritorio (desktop/static/index.html) no pinta nada en el
# contenedor de API pura — si se cuela, resolve_static_dir() lo detecta y main.py
# activa modo "sirvo una SPA" (ApiPrefixMiddleware + fallback a index.html en rutas
# no encontradas), devolviendo HTML 200 en vez de 404/JSON para cualquier ruta que
# no matchee exacto. Fuera de aquí; el target allinone monta su propio static aparte.
RUN rm -rf desktop

RUN chmod +x startup.sh

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

CMD ["./startup.sh"]

# ---------------------------------------------------------------------------
# Frontend only (nginx + SPA)
# ---------------------------------------------------------------------------
FROM nginx:1.29-alpine AS frontend
# apk upgrade picks up patched Alpine packages (e.g. libcrypto3/libssl3). The
# registry buildcache (mode=max) would otherwise reuse a stale upgrade layer —
# seen 2026-10-09: pcre2/tiff blocked Trivy. CI passes today's date.
ARG APK_CACHEBUST=2026-10-09
RUN apk update && apk upgrade --no-cache
# Plantilla: el entrypoint de nginx sustituye ${FRAME_ANCESTORS} al arrancar (solo variables
# definidas; $uri y compañía quedan intactas). Por defecto nadie puede incrustar Soberan; en el
# homelab el job pone https://agora.andreaosma.com para abrirlo dentro de ágora.
ENV FRAME_ANCESTORS="'none'"
COPY apps/soberan/deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=frontend-build /build/apps/soberan/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# ---------------------------------------------------------------------------
# All-in-one (default): SPA served by FastAPI + API on :8080
# ---------------------------------------------------------------------------
FROM api AS allinone

COPY --from=frontend-build /build/apps/soberan/dist /app/static

ENV SOBERAN_STATIC_DIR=/app/static \
    DATABASE_URL=sqlite:////data/soberan.db \
    PORT=8080 \
    CORS_ALLOW_ORIGINS=http://localhost:8080,http://127.0.0.1:8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/', timeout=3).getcode()==200 else 1)"
