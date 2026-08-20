# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Soberan desktop (Windows folder bundle / macOS .app bundle)."""
import os
import sys
from pathlib import Path

backend = Path(SPECPATH)
static = backend / "desktop" / "static"
version_file = backend / "desktop" / "VERSION"
alembic_dir = backend / "alembic"

datas = [
    (str(alembic_dir), "alembic"),
    (str(backend / "alembic.ini"), "."),
]
if version_file.is_file():
    datas.append((str(version_file), os.path.join("desktop", "VERSION")))
if static.is_dir() and any(static.iterdir()):
    datas.append((str(static), os.path.join("desktop", "static")))

hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "alembic",
    "alembic.config",
    "alembic.runtime.migration",
    "pandas",
    "icalendar",
    "pypdf",
    "bs4",
    "multipart",
]

a = Analysis(
    ["desktop_launcher.py"],
    pathex=[str(backend)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["psycopg2", "psycopg2_binary"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Soberan",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Soberan",
)

# Only meaningful on macOS — wraps COLLECT's output into Soberan.app so it can be
# dropped into a .dmg. Guarded explicitly (rather than relying on PyInstaller's own
# platform check) so this spec keeps building the Windows folder bundle unchanged
# when run under Wine (build-desktop-ci.sh, sys.platform there is "win32").
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Soberan.app",
        icon=None,
        bundle_identifier="com.andreaosma.soberan",
    )
