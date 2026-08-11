"""AEAT-style IRPF withholding calculator (rendimientos del trabajo).

Implements the core of the Agencia Tributaria retention algorithm for 2026,
driven by the same personal/family inputs as Modelo 145 (comunicación de
datos al pagador). Orientative — not a substitute for the official AEAT
service or payroll software.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import floor
from typing import Any, Dict, List, Literal, Optional


FamilySituation = Literal["1", "2", "3"]
DisabilityDegree = Literal["none", "33_64", "65_plus"]
ContractType = Literal["indefinido", "temporal", "especial"]


@dataclass
class Dependent:
    """Descendant or ascendant for mínimo familiar."""

    kind: Literal["descendant", "ascendant"]
    age: int
    disability: DisabilityDegree = "none"
    shared_custody: bool = False  # 50% of descendant minimum
    mobility_reduced: bool = False


def truncate2(value: float) -> float:
    """AEAT truncates the withholding rate to 2 decimal places (not round)."""
    return floor(value * 100.0 + 1e-9) / 100.0


def annual_retention_quota(base: float) -> float:
    """Progressive retention scale AEAT 2026 (absolute limits)."""
    brackets = [
        (12_450.0, 0.19),
        (20_200.0, 0.24),
        (35_200.0, 0.30),
        (60_000.0, 0.37),
        (300_000.0, 0.45),
        (float("inf"), 0.47),
    ]
    remaining = max(base, 0.0)
    prev = 0.0
    tax = 0.0
    for limit, rate in brackets:
        width = min(max(limit - prev, 0.0), remaining)
        if width <= 0:
            prev = limit
            continue
        tax += width * rate
        remaining -= width
        prev = limit
        if remaining <= 0:
            break
    return max(tax, 0.0)


def art20_trabajo_reduction(rend_neto: float) -> float:
    """Reducción art. 20 LIRPF (estimación 2026)."""
    # Intervalos alineados con la actualización 2026 (máx. 7.302 €).
    if rend_neto <= 14_747.5:
        return 7_302.0
    if rend_neto <= 19_747.5:
        return max(0.0, 7_302.0 - 1.14 * (rend_neto - 14_747.5))
    return 0.0


def disability_minimum(degree: DisabilityDegree, mobility_reduced: bool = False) -> float:
    if degree == "65_plus" or mobility_reduced:
        return 9_000.0
    if degree == "33_64":
        return 3_000.0
    return 0.0


def personal_minimum(age: int, disability: DisabilityDegree, mobility_reduced: bool = False) -> float:
    base = 5_550.0
    if age >= 75:
        base += 1_150.0 + 1_400.0
    elif age >= 65:
        base += 1_150.0
    base += disability_minimum(disability, mobility_reduced)
    return base


def descendants_minimum(dependents: List[Dependent]) -> float:
    kids = [d for d in dependents if d.kind == "descendant"]
    # Order: youngest first for under-3 bonus, ordinal amounts by declaration order.
    kids_sorted = sorted(kids, key=lambda d: d.age)
    total = 0.0
    ordinal_amounts = [2_400.0, 2_700.0, 4_000.0]  # 4th+ → 4_500
    for i, kid in enumerate(kids_sorted):
        amount = ordinal_amounts[i] if i < 3 else 4_500.0
        if kid.age < 3:
            amount += 2_800.0
        amount += disability_minimum(kid.disability, kid.mobility_reduced)
        if kid.shared_custody:
            amount *= 0.5
        total += amount
    return total


def ascendants_minimum(dependents: List[Dependent]) -> float:
    total = 0.0
    for dep in dependents:
        if dep.kind != "ascendant":
            continue
        amount = 1_150.0
        if dep.age >= 75:
            amount += 1_400.0
        amount += disability_minimum(dep.disability, dep.mobility_reduced)
        total += amount
    return total


def exclusion_limit(situation: FamilySituation, n_descendants: int) -> float:
    """Annual gross under which withholding is zero (simplified AEAT table 2026)."""
    # Base rows without descendants (approx. AEAT informative table 2026).
    base = {"1": 17_197.0, "2": 17_197.0, "3": 15_876.0}[situation]
    # Extra per descendant — coarse approximation of the AEAT table steps.
    extra_per_child = {"1": 2_800.0, "2": 2_100.0, "3": 1_800.0}[situation]
    return base + max(n_descendants, 0) * extra_per_child


def apply_43pct_cap(annual_gross: float, raw_retention: float) -> float:
    """For gross ≤ 35_200, retention cannot exceed 43% of excess over 15_876-ish band."""
    if annual_gross <= 0 or annual_gross > 35_200:
        return raw_retention
    # Simplified cap used by AEAT around the general exclusion threshold.
    excess = max(annual_gross - 15_876.0, 0.0)
    cap = excess * 0.43
    return min(raw_retention, cap)


def ss_rate_for_contract(contract_type: ContractType) -> float:
    # CC 4.70 + desempleo 1.55/1.60 + FP 0.10 + MEI 0.15
    if contract_type == "temporal":
        return 6.55
    return 6.50


def calculate_retencion(
    *,
    annual_gross: float,
    age: int,
    family_situation: FamilySituation = "3",
    disability: DisabilityDegree = "none",
    mobility_reduced: bool = False,
    dependents: Optional[List[Dependent]] = None,
    contract_type: ContractType = "indefinido",
    pagas: int = 14,
    ss_pct: Optional[float] = None,
    geographic_mobility: bool = False,
) -> Dict[str, Any]:
    annual_gross = max(float(annual_gross), 0.0)
    pagas = max(int(pagas), 12)
    dependents = dependents or []
    n_desc = sum(1 for d in dependents if d.kind == "descendant")

    if ss_pct is None:
        ss_pct = ss_rate_for_contract(contract_type)
    ss_rate = max(float(ss_pct), 0.0) / 100.0
    annual_ss = annual_gross * ss_rate

    rend_neto = max(annual_gross - annual_ss, 0.0)
    other_expenses = 2_000.0
    if disability in ("33_64", "65_plus") or mobility_reduced:
        # Incremento gastos por discapacidad del trabajador (simplificado).
        other_expenses += 3_500.0 if disability == "65_plus" or mobility_reduced else 2_000.0
    if geographic_mobility:
        other_expenses += 2_000.0

    art20 = art20_trabajo_reduction(rend_neto)
    retention_base = max(rend_neto - other_expenses - art20, 0.0)

    min_personal = personal_minimum(age, disability, mobility_reduced)
    min_desc = descendants_minimum(dependents)
    min_asc = ascendants_minimum(dependents)
    # Situación 2: cónyuge sin rentas → mínimo familiar adicional del cónyuge (simplificado).
    spouse_min = 3_400.0 if family_situation == "2" else 0.0
    family_min = min_personal + min_desc + min_asc + spouse_min

    quota = annual_retention_quota(retention_base)
    quota_min = annual_retention_quota(family_min)
    raw_retention = max(quota - quota_min, 0.0)

    excl = exclusion_limit(family_situation, n_desc)
    if annual_gross <= excl:
        raw_retention = 0.0
    else:
        raw_retention = apply_43pct_cap(annual_gross, raw_retention)

    if annual_gross > 0 and raw_retention > 0:
        irpf_pct = truncate2((raw_retention / annual_gross) * 100.0)
    else:
        irpf_pct = 0.0

    # Minimum rates by contract type when retention would otherwise be positive / zero rules.
    if contract_type == "temporal" and irpf_pct > 0:
        irpf_pct = max(irpf_pct, 2.0)
    elif contract_type == "especial":
        irpf_pct = max(irpf_pct, 15.0)

    annual_irpf = annual_gross * irpf_pct / 100.0
    bruto_mensual = annual_gross / pagas
    irpf_amount = bruto_mensual * irpf_pct / 100.0
    ss_amount = bruto_mensual * ss_rate
    neto = max(bruto_mensual - irpf_amount - ss_amount, 0.0)

    return {
        "annual_gross": round(annual_gross, 2),
        "pagas": pagas,
        "bruto_mensual": round(bruto_mensual, 2),
        "contract_type": contract_type,
        "family_situation": family_situation,
        "age": int(age),
        "ss_pct": round(ss_rate * 100.0, 2),
        "irpf_pct": irpf_pct,
        "ss_amount": round(ss_amount, 2),
        "irpf_amount": round(irpf_amount, 2),
        "neto_estimado": round(neto, 2),
        "annual_ss": round(annual_ss, 2),
        "annual_irpf": round(annual_irpf, 2),
        "rend_neto": round(rend_neto, 2),
        "other_expenses": round(other_expenses, 2),
        "art20_reduction": round(art20, 2),
        "retention_base": round(retention_base, 2),
        "family_minimum": round(family_min, 2),
        "exclusion_limit": round(excl, 2),
        "quota": round(quota, 2),
        "quota_minimum": round(quota_min, 2),
        "n_descendants": n_desc,
        "source": "modelo145-aeat2026",
        "disclaimer": (
            "Estimación orientativa según algoritmo AEAT 2026 y datos tipo Modelo 145. "
            "No sustituye el Servicio de Cálculo de Retenciones oficial ni la nómina del pagador."
        ),
    }


def dependents_from_payload(raw: Optional[List[Dict[str, Any]]]) -> List[Dependent]:
    out: List[Dependent] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind") or "descendant"
        if kind not in ("descendant", "ascendant"):
            continue
        degree = item.get("disability") or "none"
        if degree not in ("none", "33_64", "65_plus"):
            degree = "none"
        try:
            age = int(item.get("age", 0))
        except (TypeError, ValueError):
            age = 0
        out.append(
            Dependent(
                kind=kind,  # type: ignore[arg-type]
                age=max(age, 0),
                disability=degree,  # type: ignore[arg-type]
                shared_custody=bool(item.get("shared_custody")),
                mobility_reduced=bool(item.get("mobility_reduced")),
            )
        )
    return out
