"""CSV export/import routes."""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..csv_coerce import coerce_field

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
    columns = [c.name for c in model.__table__.columns]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    for row in rows:
        writer.writerow({name: getattr(row, name) for name in columns})
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
    model = CSV_TABLE_MODELS[table]
    columns = {c.name: c for c in model.__table__.columns}
    raw = (await file.read()).decode("utf-8-sig")
    for row in csv.DictReader(io.StringIO(raw)):
        row.pop("id", None)
        fields = {}
        for name, value in row.items():
            if name not in columns:
                continue
            coerced = coerce_field(columns[name], value)
            if coerced is not None:
                fields[name] = coerced
        db.add(model(**fields))
    db.commit()
    return {"status": "ok"}
