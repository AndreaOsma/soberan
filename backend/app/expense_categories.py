"""Fixed expense/income category taxonomy for transactions."""
from __future__ import annotations

EXPENSE_CATEGORIES: tuple[str, ...] = (
    "Alimentación",
    "Transporte",
    "Hogar",
    "Salud",
    "Ocio",
    "Suscripciones",
    "Ropa",
    "Educación",
    "Impuestos",
    "Seguros",
    "Regalos",
    "Viajes",
    "Deudas",
    "Ahorro / inversión",
    "Otros gastos",
)

INCOME_CATEGORIES: tuple[str, ...] = (
    "Nómina",
    "Freelance",
    "Devolución",
    "Transferencia recibida",
    "Otros ingresos",
)

INTERNAL_TRANSFER_CATEGORY = "Transferencia interna"
SUBSCRIPTION_CATEGORY = "Suscripciones"

_CATEGORY_ALIASES: dict[str, str] = {
    "suscripciones y facturas": SUBSCRIPTION_CATEGORY,
    "suscripciones": SUBSCRIPTION_CATEGORY,
    "streaming": SUBSCRIPTION_CATEGORY,
    "vivienda": "Hogar",
    "hogar": "Hogar",
    "alimentacion": "Alimentación",
    "alimentación": "Alimentación",
    "supermercado": "Alimentación",
    "ocio": "Ocio",
    "transporte": "Transporte",
    "salud": "Salud",
    "deudas": "Deudas",
    "deuda": "Deudas",
    "nomina": "Nómina",
    "nómina": "Nómina",
    "salario": "Nómina",
    "ahorro": "Ahorro / inversión",
    "inversion": "Ahorro / inversión",
    "inversión": "Ahorro / inversión",
    "ahorro / inversión": "Ahorro / inversión",
    "otros": "Otros gastos",
    "otro": "Otros gastos",
    "otros gastos": "Otros gastos",
    "otros ingresos": "Otros ingresos",
    "general": "",
    "sin categoría": "",
    "sin categoria": "",
    "g": "",
    "deseos": "Ocio",
  "ingreso": "Otros ingresos",
}

_EXPENSE_LOWER = {c.lower(): c for c in EXPENSE_CATEGORIES}
_INCOME_LOWER = {c.lower(): c for c in INCOME_CATEGORIES}

# Tokens too generic to learn as merchant rules
LEARN_TOKEN_DENYLIST = frozenset({
    "compra", "compras", "pago", "pagos", "cargo", "cargos",
    "bizum", "transfer", "transferencia", "traspaso", "recibo",
    "adeudo", "abono", "reintegro", "cajero", "atm", "card",
    "tarjeta", "visa", "mastercard", "movimiento", "importado",
    "gocardless", "pending", "sepa", "core", "b2b",
})


def normalize_category(raw: str | None) -> str:
    trimmed = (raw or "").strip()
    if not trimmed:
        return ""
    if trimmed.lower() == INTERNAL_TRANSFER_CATEGORY.lower():
        return INTERNAL_TRANSFER_CATEGORY
    alias = _CATEGORY_ALIASES.get(trimmed.lower())
    if alias is not None:
        return alias
    if trimmed.lower() in _EXPENSE_LOWER:
        return _EXPENSE_LOWER[trimmed.lower()]
    if trimmed.lower() in _INCOME_LOWER:
        return _INCOME_LOWER[trimmed.lower()]
    return trimmed


def is_canonical_expense(cat: str) -> bool:
    return (cat or "").strip().lower() in _EXPENSE_LOWER


def is_canonical_income(cat: str) -> bool:
    return (cat or "").strip().lower() in _INCOME_LOWER


def is_canonical_category(cat: str) -> bool:
    n = normalize_category(cat)
    if not n:
        return False
    if n == INTERNAL_TRANSFER_CATEGORY:
        return True
    return is_canonical_expense(n) or is_canonical_income(n)


def canonicalize_for_amount(cat: str, amount: float) -> str:
    """Normalize and, if still non-canonical, return empty (do not invent)."""
    n = normalize_category(cat)
    if not n:
        return ""
    if n == INTERNAL_TRANSFER_CATEGORY:
        return n
    if amount > 0:
        return n if is_canonical_income(n) else (n if is_canonical_expense(n) else "")
    return n if is_canonical_expense(n) else (n if is_canonical_income(n) else "")


def is_learnable_token(token: str) -> bool:
    t = (token or "").strip().lower()
    if len(t) < 4:
        return False
    if t in LEARN_TOKEN_DENYLIST:
        return False
    if t.isdigit():
        return False
    return True
