"""Soberan FastAPI app: REST API for accounts, transactions, budgets, payroll, iCal, and agent hooks."""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import IntegrityError
from typing import Optional
import os
import logging
import traceback
from fastapi.responses import JSONResponse

# Configure professional logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("soberan")

from .database import engine
from . import models
from .desktop import (
    is_desktop_mode,
    ApiPrefixMiddleware,
    mount_desktop_static,
    resolve_static_dir,
    DESKTOP_HOST,
    DESKTOP_PORT,
)
from .routers import include_routers
from .routers.debts import _charge_datetime  # noqa: F401  # calendar_events
from .routers.calendar_ical import _add_ical_all_day  # noqa: F401  # tests
from .helpers import (
    # Re-exports for calendar_events / tests
    ENVELOPE_ACCOUNT_MAP_KEY,
    annual_irpf_quota_2026,
    envelope_account_label,
    recurring_company_from_nombre,
    resolve_income_day_with_window,
    user_settings_json,
    estimate_payroll,
    norm_company_key,
)

# Initialization — always create_all for safety, then run Alembic for schema evolution
models.Base.metadata.create_all(bind=engine)

def _alembic_next_revision(script, current: Optional[str]) -> Optional[str]:
    """Return the revision immediately after ``current`` (or first revision if unset)."""
    if current is None:
        for rev in script.walk_revisions():
            if rev.down_revision is None:
                return rev.revision
        return None
    rev = script.get_revision(current)
    if not rev or not rev.nextrev:
        return None
    nxt = rev.nextrev
    if isinstance(nxt, tuple):
        nxt = nxt[0]
    return nxt


def _alembic_schema_drift_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "duplicate column" in msg
        or "already exists" in msg
        or "duplicate table name" in msg
    )


def run_alembic_upgrade() -> None:
    """Run Alembic upgrade head after create_all (handles schema evolution in production)."""
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url or db_url.startswith("sqlite:///:memory:"):
        return
    try:
        from alembic import command as alembic_command
        from alembic.config import Config as AlembicConfig
        from alembic.runtime.migration import MigrationContext
        from alembic.script import ScriptDirectory
        from sqlalchemy import create_engine, text as sa_text

        alembic_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cfg = AlembicConfig(os.path.join(alembic_dir, "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", db_url)
        cfg.set_main_option("script_location", os.path.join(alembic_dir, "alembic"))
        script = ScriptDirectory.from_config(cfg)
        head = script.get_current_head()

        _eng = create_engine(db_url, poolclass=None)
        try:
            with _eng.connect() as _c:
                table_exists = bool(_c.execute(sa_text(
                    "SELECT COUNT(*) FROM sqlite_master "
                    "WHERE type='table' AND name='alembic_version'"
                )).scalar())
                current_rev = None
                if table_exists:
                    current_rev = _c.execute(sa_text(
                        "SELECT version_num FROM alembic_version LIMIT 1"
                    )).scalar()
                logger.info(
                    "Alembic: table_exists=%s current_rev=%r",
                    table_exists,
                    current_rev,
                )
                if not table_exists:
                    _c.execute(sa_text(
                        "CREATE TABLE alembic_version "
                        "(version_num VARCHAR(32) NOT NULL "
                        "CONSTRAINT alembic_version_pkc PRIMARY KEY)"
                    ))
                    _c.commit()
                elif not current_rev:
                    # Tables from create_all without a stamp: do not force 001 (blocks real upgrades).
                    logger.info("Alembic: empty alembic_version — upgrade will run from base")
        finally:
            _eng.dispose()

        max_drift_steps = 40
        for _ in range(max_drift_steps):
            try:
                alembic_command.upgrade(cfg, "head")
                logger.info("Alembic migrations applied.")
                return
            except Exception as e:
                if not _alembic_schema_drift_error(e):
                    raise
                with create_engine(db_url).connect() as conn:
                    current = MigrationContext.configure(conn).get_current_revision()
                if current == head:
                    logger.info("Alembic: at head after schema-drift recovery")
                    return
                nxt = _alembic_next_revision(script, current)
                if not nxt:
                    raise
                logger.info(
                    "Alembic: schema ahead of version — stamping %s (was %s)",
                    nxt,
                    current,
                )
                alembic_command.stamp(cfg, nxt)
        logger.warning("Alembic upgrade: drift recovery exceeded step limit")
    except BaseException as e:
        logger.warning(f"Alembic upgrade skipped: {type(e).__name__}: {e}")

run_alembic_upgrade()

# Column parity is handled by Alembic migrations (through 008_legacy_column_parity).

def _migrate_subscriptions_to_recurring() -> None:
    """One-time migration: copy subscriptions table → recurring_entries as tipo_partida='suscripcion'."""
    from sqlalchemy.orm import Session as _OrmSession
    db = _OrmSession(engine)
    try:
        done = db.query(models.UserSettings).filter(models.UserSettings.key == "subs_migrated_v1").first()
        if done:
            return
        subs = db.query(models.Subscription).all()
        for sub in subs:
            existing = db.query(models.RecurringEntry).filter(
                models.RecurringEntry.nombre == sub.nombre,
                models.RecurringEntry.tipo_partida == "suscripcion",
            ).first()
            if not existing:
                entry = models.RecurringEntry(
                    nombre=sub.nombre,
                    monto_estimado=sub.monto,
                    es_ingreso=False,
                    es_fijo=True,
                    categoria="Suscripciones",
                    tipo_partida="suscripcion",
                    bloque=sub.bloque,
                    frecuencia=sub.frecuencia,
                    fecha_pago=sub.fecha_pago,
                    mes_cobro=sub.mes,
                    meses_excluidos=sub.meses_excluidos,
                )
                db.add(entry)
        db.add(models.UserSettings(key="subs_migrated_v1", value="1"))
        db.commit()
        logger.info(f"Migration subs_migrated_v1: migrated {len(subs)} subscription(s) to recurring_entries")
    except Exception as exc:
        db.rollback()
        logger.warning(f"Migration subs_migrated_v1 failed: {exc}")
    finally:
        db.close()

_migrate_subscriptions_to_recurring()

app = FastAPI(title="Soberan API")

@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    detail = exc.detail
    if isinstance(detail, list):
        detail = "Datos de entrada no válidos."
    elif not isinstance(detail, str):
        detail = str(detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": detail})

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    logger.warning(f"Validation error: {exc.errors()}")
    return JSONResponse(status_code=422, content={"detail": "Datos de entrada no válidos. Revisa los campos enviados."})

@app.exception_handler(IntegrityError)
async def integrity_error_handler(_request: Request, exc: IntegrityError):
    logger.warning(f"Integrity error: {exc}")
    return JSONResponse(
        status_code=400,
        content={"detail": "La operación no es válida: duplicado o referencia a un registro inexistente."},
    )

@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc) or "Solicitud no válida."})

# Global Exception Handler
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    if isinstance(exc, HTTPException):
        return await http_exception_handler(request, exc)
    logger.error(f"Global error caught: {exc}")
    logger.error(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "Error interno del servidor"},
    )

cors_origins = os.getenv(
    "CORS_ALLOW_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8501,http://127.0.0.1:8501,http://localhost:8080,http://127.0.0.1:8080",
)
if is_desktop_mode() and "CORS_ALLOW_ORIGINS" not in os.environ:
    port = os.getenv("SOBERAN_PORT", str(DESKTOP_PORT))
    host = os.getenv("SOBERAN_HOST", DESKTOP_HOST)
    cors_origins = f"http://{host}:{port},http://127.0.0.1:{port}"
allowed_origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_static_dir = resolve_static_dir()
# Desktop and all-in-one Docker serve the SPA from the same process; strip /api like nginx.
if is_desktop_mode() or _static_dir is not None:
    app.add_middleware(ApiPrefixMiddleware)

include_routers(app)

# --- Endpoints API ---

@app.get("/")
def read_root():
    if _static_dir is not None:
        from fastapi.responses import FileResponse
        index = _static_dir / "index.html"
        if index.is_file():
            return FileResponse(index, media_type="text/html")
    return {"status": "online", "app": "Soberan"}


if _static_dir is not None:
    mount_desktop_static(app, _static_dir)
