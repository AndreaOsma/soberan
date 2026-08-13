#!/usr/bin/env bash
# Seeds plausible-looking (randomized) demo data into a running soberan backend — for Play
# Store screenshots, not for real use. Never point this at a real deployment.
#
# Usage: BASE_URL=http://127.0.0.1:17890 ./deploy/scripts/seed-demo-data.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"

_post() {
  local path="$1" body="$2"
  curl -sS -X POST "$BASE_URL$path" -H "Content-Type: application/json" -d "$body"
}

echo "==> Sembrando datos de ejemplo en $BASE_URL"

acc1=$(_post /accounts/ '{"alias_real":"Cuenta Corriente","tipo":"gasto","balance_actual":2150.40,"banco":"ING"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
acc2=$(_post /accounts/ '{"alias_real":"Ahorro","tipo":"ahorro","balance_actual":8600.00,"banco":"MyInvestor"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "    Cuentas: $acc1 (Corriente), $acc2 (Ahorro)"

python3 - "$BASE_URL" "$acc1" "$acc2" <<'PY'
import json, random, subprocess, sys
from datetime import date, timedelta

base_url, acc1, acc2 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
random.seed()

expense_tx = [
    ("Supermercado Mercadona", "Alimentación", (25, 95)),
    ("Supermercado Carrefour", "Alimentación", (20, 80)),
    ("Gasolinera Repsol", "Transporte", (35, 70)),
    ("Abono transporte", "Transporte", (54.60, 54.60)),
    ("Restaurante", "Ocio", (15, 60)),
    ("Cine", "Ocio", (8, 24)),
    ("Farmacia", "Salud", (5, 40)),
    ("Netflix", "Suscripciones", (12.99, 12.99)),
    ("Spotify", "Suscripciones", (10.99, 10.99)),
    ("Zara", "Ropa", (20, 90)),
    ("Ferretería", "Hogar", (10, 60)),
]
income_tx = [
    ("Nómina empresa", "Nómina", (1800, 2400)),
    ("Devolución Hacienda", "Devolución", (150, 600)),
]

today = date.today()
created = 0
for _ in range(14):
    name, cat, (lo, hi) = random.choice(expense_tx)
    amount = -round(random.uniform(lo, hi), 2)
    day_offset = random.randint(0, 27)
    tx_date = (today.replace(day=1) + timedelta(days=day_offset)).isoformat()
    body = {
        "account_id": acc1,
        "amount": amount,
        "category_anon": cat,
        "description_raw": name,
        "tipo_meta": "gasto",
        "date": tx_date,
    }
    r = subprocess.run(
        ["curl", "-sS", "-X", "POST", f"{base_url}/transactions/",
         "-H", "Content-Type: application/json", "-d", json.dumps(body)],
        capture_output=True, text=True,
    )
    if r.returncode == 0:
        created += 1

name, cat, (lo, hi) = income_tx[0]
body = {
    "account_id": acc1,
    "amount": round(random.uniform(lo, hi), 2),
    "category_anon": cat,
    "description_raw": name,
    "tipo_meta": "ingreso",
    "date": today.replace(day=1).isoformat(),
}
subprocess.run(
    ["curl", "-sS", "-X", "POST", f"{base_url}/transactions/",
     "-H", "Content-Type: application/json", "-d", json.dumps(body)],
    capture_output=True, text=True,
)
created += 1

print(f"    Transacciones creadas: {created}")
PY

_post /recurring-entries/ '{"nombre":"Nómina","monto_estimado":2100,"es_ingreso":true,"es_fijo":true,"categoria":"Nómina"}' >/dev/null
_post /recurring-entries/ '{"nombre":"Alquiler","monto_estimado":850,"es_ingreso":false,"es_fijo":true,"categoria":"Hogar"}' >/dev/null
_post /recurring-entries/ '{"nombre":"Netflix","monto_estimado":12.99,"es_ingreso":false,"es_fijo":true,"categoria":"Suscripciones"}' >/dev/null
_post /recurring-entries/ '{"nombre":"Gimnasio","monto_estimado":34.90,"es_ingreso":false,"es_fijo":true,"categoria":"Salud"}' >/dev/null
echo "    Partidas recurrentes: 4"

_post /settings/ '{"key":"onboarding_done","value":"true"}' >/dev/null

echo "==> Listo."
