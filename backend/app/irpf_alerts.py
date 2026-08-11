"""Alert when company IRPF withholding diverges from expected Modelo 145 / job rate."""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app import models


MIN_MONTHS = 2


def _user_setting_str(db: "Session", key: str, default: str = "") -> str:
    from app import models

    row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    if not row or not row.value:
        return default
    return str(row.value).strip()


def _normalize_empresa(value: Optional[str]) -> str:
    return " ".join((value or "").strip().lower().split())


def _parse_iso_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _job_covers_month(job: "models.WorkHistory", year: int, month: int) -> bool:
    start = _parse_iso_date(job.fecha_inicio)
    end = _parse_iso_date(job.fecha_fin) or date(9999, 12, 31)
    if not start:
        return False
    month_start = date(year, month, 1)
    # end of month approx
    if month == 12:
        month_end = date(year, 12, 31)
    else:
        month_end = date(year, month + 1, 1)
    return start <= month_end and end >= month_start


def _match_job(
    jobs: list["models.WorkHistory"],
    empresa: str,
    year: int,
    month: int,
) -> Optional["models.WorkHistory"]:
    covered = [j for j in jobs if _job_covers_month(j, year, month)]
    if not covered:
        return None
    target = _normalize_empresa(empresa)
    if target:
        for j in covered:
            if _normalize_empresa(j.empresa) == target:
                return j
        for j in covered:
            n = _normalize_empresa(j.empresa)
            if n and (n in target or target in n):
                return j
    if len(covered) == 1:
        return covered[0]
    return None


def _parse_modelo145_versions(raw: str) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, dict):
        return []
    versions = parsed.get("versions")
    if isinstance(versions, list):
        out: list[dict[str, Any]] = []
        for v in versions:
            if not isinstance(v, dict):
                continue
            ef = str(v.get("effective_from") or "")[:10]
            if len(ef) != 10:
                continue
            job_raw = v.get("job_id")
            try:
                job_id = int(job_raw) if job_raw is not None and str(job_raw).strip() != "" else None
            except (TypeError, ValueError):
                job_id = None
            out.append({
                "effective_from": ef,
                "irpf_pct": float(v.get("irpf_pct") or 0),
                "job_id": job_id,
            })
        out.sort(key=lambda x: x["effective_from"])
        return out
    # Legacy flat snapshot
    if parsed.get("family_situation") or parsed.get("annual_gross") or parsed.get("irpf_pct"):
        return [{
            "effective_from": str(parsed.get("effective_from") or "2000-01-01")[:10],
            "irpf_pct": float(parsed.get("irpf_pct") or 0),
            "job_id": None,
        }]
    return []


def _resolve_pct(
    versions: list[dict[str, Any]],
    day_iso: str,
    job_id: Optional[int],
    job_pct: Optional[float],
) -> Optional[float]:
    # Prefer versions scoped to this work_history id; ignore personal (null) rates for employers.
    if job_id is not None:
        scoped = [v for v in versions if v.get("job_id") == job_id and v["effective_from"] <= day_iso]
    else:
        scoped = [v for v in versions if v.get("job_id") is None and v["effective_from"] <= day_iso]
    ver_pct = float(scoped[-1]["irpf_pct"]) if scoped else None
    if ver_pct is not None and ver_pct > 0:
        return ver_pct
    if job_pct is not None and float(job_pct) > 0:
        return float(job_pct)
    return None


def _gap_threshold(bruto_total: float) -> float:
    return max(50.0, bruto_total * 0.015)


def compute_withholding_gap(
    breakdowns: list["models.SalaryBreakdown"],
    work_history: list["models.WorkHistory"],
    modelo145_raw: str,
    year: int,
) -> Optional[dict[str, Any]]:
    rows = [r for r in breakdowns if int(r.anio or 0) == year and float(r.bruto or 0) > 0]
    if not rows:
        return None

    versions = _parse_modelo145_versions(modelo145_raw)
    bruto_total = 0.0
    irpf_real = 0.0
    irpf_expected = 0.0
    rate_weighted = 0.0
    months_with_rate = 0

    for row in rows:
        job = _match_job(work_history, str(row.empresa or ""), int(row.anio), int(row.mes))
        day_iso = f"{int(row.anio):04d}-{int(row.mes):02d}-01"
        job_pct = float(job.irpf_pct) if job and job.irpf_pct is not None else None
        job_id = int(job.id) if job and getattr(job, "id", None) is not None else None
        pct = _resolve_pct(versions, day_iso, job_id, job_pct)
        bruto = float(row.bruto or 0)
        bruto_total += bruto
        irpf_real += float(row.irpf or 0)
        if pct is None:
            continue
        months_with_rate += 1
        rate_weighted += pct * bruto
        irpf_expected += bruto * pct / 100.0

    if months_with_rate < MIN_MONTHS or bruto_total <= 0:
        return None

    gap_reten = irpf_real - irpf_expected
    threshold = _gap_threshold(bruto_total)
    if abs(gap_reten) < threshold:
        return None

    pct_real = (irpf_real / bruto_total) * 100.0
    pct_expected = rate_weighted / bruto_total
    over = gap_reten > 0
    return {
        "gap_reten": gap_reten,
        "pct_real": pct_real,
        "pct_expected": pct_expected,
        "months": months_with_rate,
        "year": year,
        "over_withheld": over,
        "severity": "alta" if abs(gap_reten) >= threshold * 2 else "media",
    }


def build_irpf_withholding_alert(db: "Session", ref_date: Optional[date] = None) -> Optional[dict[str, Any]]:
    from app import models

    ref = ref_date or date.today()
    year = ref.year
    breakdowns = db.query(models.SalaryBreakdown).filter(models.SalaryBreakdown.anio == year).all()
    work_history = db.query(models.WorkHistory).all()
    modelo_raw = _user_setting_str(db, "irpf_modelo145")

    gap = compute_withholding_gap(breakdowns, work_history, modelo_raw, year)
    if not gap:
        return None

    abs_gap = abs(gap["gap_reten"])
    if gap["over_withheld"]:
        mensaje = (
            f"IRPF de la empresa alto: retiene ~{gap['pct_real']:.1f}% frente al ~{gap['pct_expected']:.1f}% esperado "
            f"(+{abs_gap:.0f}€ en {gap['months']} nóminas de {year}). "
            "La renta del año que viene es más probable a devolver."
        )
    else:
        mensaje = (
            f"IRPF de la empresa bajo: retiene ~{gap['pct_real']:.1f}% frente al ~{gap['pct_expected']:.1f}% esperado "
            f"({abs_gap:.0f}€ de menos en {gap['months']} nóminas de {year}). "
            "La renta del año que viene es más probable a pagar."
        )

    return {
        "tipo": "irpf_retencion_desviada",
        "severidad": gap["severity"],
        "mensaje": mensaje,
        "id": None,
    }
