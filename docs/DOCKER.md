# Docker (self-hosted)

One image runs the Vite SPA and the FastAPI API (Uvicorn) on port **8080**.
SQLite lives in the named volume `soberan_data` at `/data/soberan.db`.

## Quick run

From `deploy/`:

```bash
cp .env.example .env
# Edit .env if you want a custom port or SOBERAN_API_KEY.

docker compose up -d --build
```

Then open `http://127.0.0.1:8080/` (or the host port set in `SOBERAN_HTTP_PORT`).

Health:

```bash
curl -fsS http://127.0.0.1:8080/
curl -fsS http://127.0.0.1:8080/api/accounts/ | head
```

## Image (single Dockerfile)

From the repository root, the default target is **all-in-one**:

```bash
docker build -t soberan:local .
docker run --rm -p 8080:8080 -v soberan_data:/data soberan:local
```

Or from Docker Hub:

```bash
docker pull andreaosma/soberan:latest
docker run --rm -p 8080:8080 -v soberan_data:/data andreaosma/soberan:latest
```

Optional split targets (API-only, or static SPA behind your own reverse proxy — used by some self-host layouts):

```bash
docker build --target api -t soberan-api:local .
docker build --target frontend -t soberan-frontend:local .
```

## Data backup

```bash
docker compose cp soberan:/data/soberan.db ./soberan-backup.db
```

Restore by stopping the stack, placing the file back into the volume, then starting again.
