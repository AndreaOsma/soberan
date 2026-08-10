# Single multi-stage Dockerfile for Soberan.
#
# Default (Docker Hub / Compose): all-in-one SPA + API on :8080
#   docker build -t soberan:local .
#
# Optional split images (API-only, or SPA behind your own reverse proxy):
#   docker build --target api -t soberan-api .
#   docker build --target frontend -t soberan-frontend .
#
# Build context: repository root.

# ---------------------------------------------------------------------------
# Frontend (Vite)
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app
ENV NODE_ENV=development
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_AUDIT=false

COPY package.json package-lock.json ./
RUN npm ci \
  && test -x node_modules/.bin/tsc \
  && test -x node_modules/.bin/vite

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json eslint.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# API only (FastAPI + Uvicorn)
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS api
WORKDIR /app

# psycopg2-binary ships wheels — no build-essential/libpq-dev (avoids linux-libc-dev CVEs).
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip "setuptools>=83" "wheel>=0.46.2" \
  && pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir "jaraco.context>=6.1.0" \
  # PEP 770 / third-party SBOMs (e.g. from pip) list stale transitive pins that Trivy
  # then flags even when METADATA shows the upgraded packages (or packages not installed).
  && find /usr/local -type d -name sboms -prune -exec rm -rf {} + 2>/dev/null || true \
  && find /usr/local -type f \( -name '*.spdx.json' -o -name '*.cdx.json' -o -name 'sbom.json' \) -delete 2>/dev/null || true \
  && python -c "import setuptools; assert tuple(map(int, setuptools.__version__.split('.')[:2])) >= (83, 0), setuptools.__version__"

COPY backend/ .

RUN chmod +x startup.sh

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

CMD ["./startup.sh"]

# ---------------------------------------------------------------------------
# Frontend only (nginx + SPA)
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS frontend
RUN apk update && apk upgrade --no-cache
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# ---------------------------------------------------------------------------
# All-in-one (default): SPA served by FastAPI + API on :8080
# ---------------------------------------------------------------------------
FROM api AS allinone

COPY --from=frontend-build /app/dist /app/static

ENV SOBERAN_STATIC_DIR=/app/static \
    DATABASE_URL=sqlite:////data/soberan.db \
    PORT=8080 \
    CORS_ALLOW_ORIGINS=http://localhost:8080,http://127.0.0.1:8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/', timeout=3).getcode()==200 else 1)"
