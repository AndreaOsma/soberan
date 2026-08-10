"""Forzar SQLite en memoria para tests (evita depender de PostgreSQL / host «db»)."""
import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from app.database import SessionLocal


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()
