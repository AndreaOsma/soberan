"""CSV export/import routes."""
from __future__ import annotations

import io
import zipfile
from datetime import datetime
from typing import Any, Dict

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter()

CSV_TABLE_MODELS: Dict[str, Any] = {
    "accounts": models.Account,
    "transactions": models.Transaction,
    "goals": models.Goal,
    "debts": models.Debt,
    "properties": models.Property,
    "investments": models.Investment,
    "work-history": models.WorkHistory,
    "salary-breakdown": models.SalaryBreakdown,
    "recurring-entries": models.RecurringEntry,
}

CSV_TABLE_SLUGS: Dict[str, str] = {
    "accounts": "cuentas",
    "transactions": "transacciones",
    "recurring-entries": "partidas-recurrentes",
    "goals": "objetivos",
    "debts": "deudas",
    "investments": "inversiones",
    "properties": "activos-fijos",
    "work-history": "historial-laboral",
    "salary-breakdown": "desglose-nomina",
}


def _csv_bytes_for_table(db: Session, table: str) -> bytes:
    model = CSV_TABLE_MODELS.get(table)
    if not model:
        raise HTTPException(status_code=400, detail="Tabla no válida para exportación")
    rows = db.query(model).all()
    df = pd.DataFrame([{c.name: getattr(q, c.name) for c in q.__table__.columns} for q in rows])
    stream = io.StringIO()
    df.to_csv(stream, index=False)
    return ("\ufeff" + stream.getvalue()).encode("utf-8")


@router.get("/export-csv/bundle")
def export_csv_bundle(db: Session = Depends(get_db)):
    """ZIP con todas las tablas exportables (CSV UTF-8 con BOM para Excel)."""
    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for table in CSV_TABLE_MODELS:
            slug = CSV_TABLE_SLUGS.get(table, table)
            zf.writestr(f"soberan-{slug}-{stamp}.csv", _csv_bytes_for_table(db, table))
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="soberan-export-{stamp}.zip"'},
    )


@router.get("/export-csv/{table}")
def export_csv(table: str, db: Session = Depends(get_db)):
    if table not in CSV_TABLE_MODELS:
        raise HTTPException(status_code=400, detail="Tabla no válida para exportación")
    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    slug = CSV_TABLE_SLUGS.get(table, table)
    content = _csv_bytes_for_table(db, table)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="soberan-{slug}-{stamp}.csv"'},
    )


@router.post("/import-csv/{table}")
async def import_csv(table: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if table not in CSV_TABLE_MODELS:
        raise HTTPException(status_code=400, detail="Tabla no válida para importación")
    m_map = CSV_TABLE_MODELS
    df = pd.read_csv(io.BytesIO(await file.read()))
    for _, row in df.iterrows():
        rd = row.to_dict()
        if 'id' in rd: del rd['id']
        for c in ['date', 'fecha_inicio', 'fecha_fin']:
            if c in rd and pd.notnull(rd[c]):
                try:
                    rd[c] = pd.to_datetime(rd[c])
                except (ValueError, TypeError):
                    pass
        db_i = m_map[table](**{k: v for k, v in rd.items() if pd.notnull(v)})
        db.add(db_i)
    db.commit(); return {"status": "ok"}
