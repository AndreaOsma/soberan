"""Parse MyInvestor position export PDFs."""
from __future__ import annotations

import io
import re


def parse_myinvestor_pdf_text(text: str) -> dict:
    if "MyInvestor" not in text and "myinvestor" not in text.lower():
        raise ValueError("No parece un extracto de MyInvestor")

    def parse_eur(s: str) -> float:
        return float(s.replace(".", "").replace(",", "."))

    cuenta = ""
    m = re.search(r"Cuenta:\s*(ES\d+)", text)
    if m:
        cuenta = m.group(1)

    efectivo = 0.0
    m = re.search(r"\nEfectivo\s+([\d.,]+)\s*¤", text)
    if m:
        efectivo = parse_eur(m.group(1))

    positions = []
    pos_match = re.search(r"Posiciones\n(.+?)(?:Tarjetas|\Z)", text, re.DOTALL)
    if pos_match:
        pos_text = pos_match.group(1)
        isin_re = re.compile(
            r"([A-Z]{2}[A-Z0-9]{10})\s+(.*?)(?=(?:[A-Z]{2}[A-Z0-9]{10})|Tarjetas|\Z)",
            re.DOTALL,
        )
        bond_kw = ("BOND", "SHORT DUR", "MONEY MKT", "TRESOR", "CREDIT", "COVERED",
                   "AGGRE", "SHDUR", "INSTICASH", "RATED RESP")
        pension_kw = ("PENSION", "PENSIÓN", "PP ", "PLAN DE PENSIONES", "JUBILACION", "JUBILACIÓN")
        for match in isin_re.finditer(pos_text):
            isin = match.group(1)
            entry = match.group(2).replace("\n", " ")
            eur_amounts = re.findall(r"([\d.]+,[\d]+)\s*¤", entry)
            if not eur_amounts:
                continue
            valor_eur = parse_eur(eur_amounts[-1])
            name_m = re.match(r"(.+?)\s+(?:EUR|USD|GBP)\s+[\d.]+\s", entry)
            nombre = (name_m.group(1).strip() if name_m
                      else re.split(r"\s+(?:EUR|USD|GBP)\s", entry)[0].strip())[:100]
            nombre_up = nombre.upper()
            if any(kw in nombre_up for kw in bond_kw):
                tipo = "deuda"
            elif any(kw in nombre_up for kw in pension_kw):
                tipo = "pension"
            else:
                tipo = "fondo"
            positions.append({
                "isin": isin,
                "nombre": nombre,
                "valor_actual": valor_eur,
                "monto_invertido": 0.0,
                "tipo": tipo,
            })

    debt = None
    loan_m = re.search(
        r"(\d{6,})\s+VIGENTE\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s+"
        r"([\d.,]+)\s*¤\s*([\d.,]+)\s*¤\s*([\d.,]+)\s*¤\s*([\d.,]+)\s*%",
        text,
    )
    if loan_m:
        d, mo, y = loan_m.group(3).split("/")
        debt = {
            "acreedor": "MyInvestor",
            "cuenta_prestamo": loan_m.group(1),
            "monto_total": parse_eur(loan_m.group(4)),
            "monto_pagado": parse_eur(loan_m.group(5)),
            "pendiente": parse_eur(loan_m.group(6)),
            "tasa_anual": float(loan_m.group(7)),
            "fecha_vencimiento": f"{y}-{mo}-{d}T00:00:00",
            "tipo": "Préstamo personal",
            "notas": f"Cuenta préstamo MyInvestor nº {loan_m.group(1)}",
        }

    if efectivo > 0:
        positions.append({
            "isin": "EFECTIVO",
            "nombre": "Efectivo disponible",
            "valor_actual": efectivo,
            "monto_invertido": efectivo,
            "tipo": "efectivo",
        })

    return {"cuenta": cuenta, "efectivo": efectivo, "positions": positions, "debt": debt}


def parse_myinvestor_pdf_bytes(content: bytes) -> dict:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return parse_myinvestor_pdf_text(text)
