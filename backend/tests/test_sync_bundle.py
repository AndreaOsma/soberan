"""El bundle de sync debe salir idéntico si los datos no cambian: native_sync decide si hay
cambios locales comparando hashes, y un ZIP con fecha u hora dentro daría falsos positivos
(subidas de más y conflictos inventados con otros dispositivos)."""
import io
import zipfile

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base
from app.sync_bundle import export_bundle_bytes, import_bundle_replace


@pytest.fixture
def seeded():
    """Base propia en memoria: import_bundle_replace sustituye todas las tablas, y la base
    compartida de la suite (conftest) la usan tests que cuentan filas."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add_all([
        models.Account(alias_real="B", alias_anonimo="ACC_B", tipo="corriente", banco="B"),
        models.Account(alias_real="A", alias_anonimo="ACC_A", tipo="corriente", banco="A"),
    ])
    db.commit()
    yield db
    db.close()
    engine.dispose()


def test_export_is_deterministic(seeded):
    first = export_bundle_bytes(seeded)
    assert export_bundle_bytes(seeded) == first
    names = zipfile.ZipFile(io.BytesIO(first)).namelist()
    assert "soberan-cuentas.csv" in names


def test_import_accepts_old_dated_member_names(seeded):
    current = zipfile.ZipFile(io.BytesIO(export_bundle_bytes(seeded)))
    old = io.BytesIO()
    with zipfile.ZipFile(old, "w") as zf:
        for name in current.namelist():
            zf.writestr(name.replace(".csv", "-2026-08-15.csv"), current.read(name))
    loaded = import_bundle_replace(seeded, old.getvalue())
    assert loaded.get("accounts") == 2
