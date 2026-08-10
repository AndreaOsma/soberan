"""PDF import routes (MyInvestor / ING)."""
from __future__ import annotations

import io
import re
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..myinvestor_pdf import parse_myinvestor_pdf_bytes

router = APIRouter()


@router.post("/import/myinvestor-pdf/")
async def import_myinvestor_pdf(file: UploadFile = File(...)):
    """Parse a MyInvestor account statement PDF and return investments, debt, and cash balance."""
    try:
        content = await file.read()
        return parse_myinvestor_pdf_bytes(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Error al procesar PDF de MyInvestor: {str(e)}")


@router.post("/import/myinvestor-pdf/apply")
async def apply_myinvestor_pdf(
    file: UploadFile = File(...),
    cartera: str = Form(default="MyInvestor"),
    db: Session = Depends(get_db),
):
    """Parse MyInvestor PDF and upsert investments / debt in one step."""
    try:
        content = await file.read()
        parsed = parse_myinvestor_pdf_bytes(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Error al procesar PDF de MyInvestor: {str(e)}")

    cartera_name = (cartera or "MyInvestor").strip() or "MyInvestor"
    positions = parsed.get("positions") or []
    if not positions and not parsed.get("debt"):
        raise HTTPException(status_code=422, detail="No se encontraron posiciones en el PDF")

    created = 0
    updated = 0
    existing = db.query(models.Investment).filter(models.Investment.cartera == cartera_name).all()
    by_name = {inv.nombre: inv for inv in existing}

    for pos in positions:
        payload = {
            "nombre": pos["nombre"],
            "valor_actual": pos["valor_actual"],
            "monto_invertido": pos.get("monto_invertido") or 0.0,
            "tipo": pos.get("tipo") or "fondo",
            "cartera": cartera_name,
        }
        match = by_name.get(pos["nombre"])
        if match:
            match.valor_actual = payload["valor_actual"]
            if payload["monto_invertido"]:
                match.monto_invertido = payload["monto_invertido"]
            match.tipo = payload["tipo"]
            updated += 1
        else:
            db.add(models.Investment(**payload))
            created += 1

    debt_created = False
    debt = parsed.get("debt")
    if debt:
        existing_debt = (
            db.query(models.Debt)
            .filter(models.Debt.acreedor == "MyInvestor", models.Debt.notas == debt.get("notas"))
            .first()
        )
        if existing_debt:
            existing_debt.monto_total = debt["monto_total"]
            existing_debt.monto_pagado = debt["monto_pagado"]
        else:
            db.add(models.Debt(
                acreedor=debt["acreedor"],
                monto_total=debt["monto_total"],
                monto_pagado=debt["monto_pagado"],
                tipo=debt["tipo"],
                fecha_vencimiento=datetime.fromisoformat(debt["fecha_vencimiento"]),
                tasa_anual=debt["tasa_anual"],
                notas=debt["notas"],
            ))
            debt_created = True

    now = datetime.utcnow().isoformat()
    setting = db.query(models.UserSettings).filter(models.UserSettings.key == "myinvestor_last_import_at").first()
    if setting:
        setting.value = now
    else:
        db.add(models.UserSettings(key="myinvestor_last_import_at", value=now))

    db.commit()
    return {
        "status": "ok",
        "cartera": cartera_name,
        "created": created,
        "updated": updated,
        "positions_total": len(positions),
        "debt_created": debt_created,
        "cuenta": parsed.get("cuenta"),
        "efectivo": parsed.get("efectivo"),
    }


@router.post("/import/ing-pdf/")
async def import_ing_pdf(file: UploadFile = File(...)):
    """Parse an ING monthly statement PDF and return account balances."""
    try:
        from pypdf import PdfReader
        content = await file.read()
        reader = PdfReader(io.BytesIO(content))
        full_text = "\n".join(page.extract_text() or "" for page in reader.pages)

        accounts = []
        for account_type in [("NÓMINA", "ACC_ING_NOM", "ING - Cuenta Nómina"),
                              ("NARANJA", "ACC_ING_NAR", "ING - Cuenta Naranja")]:
            keyword, alias_anon, alias_real = account_type
            pattern = rf"Cuenta {keyword}.*?Saldo final\s+([\d.,]+)\s*€"
            m = re.search(pattern, full_text, re.DOTALL | re.IGNORECASE)
            if not m:
                section_start = full_text.find(f"Cuenta {keyword}")
                if section_start >= 0:
                    section = full_text[section_start:section_start + 500]
                    m2 = re.search(r"Saldo final\s+([\d.]+),([\d]+)", section)
                    if m2:
                        balance = float(f"{m2.group(1).replace('.', '')}.{m2.group(2)}")
                        accounts.append({"alias_anonimo": alias_anon, "alias_real": alias_real, "balance": balance})
                        continue
            if m:
                raw = m.group(1).replace(".", "").replace(",", ".")
                accounts.append({"alias_anonimo": alias_anon, "alias_real": alias_real, "balance": float(raw)})

        return {"accounts": accounts, "raw_snippet": full_text[:500] if not accounts else None}
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Error al procesar PDF: {str(e)}")
