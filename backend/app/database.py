"""SQLAlchemy engine, session factory, and FastAPI `get_db` dependency for Soberan."""
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import os
from dotenv import load_dotenv

load_dotenv()

# Desktop bundle sets DATABASE_URL before this module loads (via desktop_launcher).
if os.getenv("SOBERAN_DESKTOP", "").strip() in ("1", "true", "yes") and not os.getenv("DATABASE_URL"):
    from .desktop import configure_desktop_environment
    configure_desktop_environment()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./test.db")

_is_memory_sqlite = DATABASE_URL == "sqlite:///:memory:"
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    poolclass=StaticPool if _is_memory_sqlite else None,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
