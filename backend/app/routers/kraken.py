"""Kraken crypto exchange balance and sync routes."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..kraken_api import KrakenAPI, is_fiat, normalize_asset

logger = logging.getLogger("soberan")
router = APIRouter()

def _kraken_client(db: Session) -> KrakenAPI:
    api_key = os.environ.get("KRAKEN_API_KEY", "").strip()
    api_secret = os.environ.get("KRAKEN_API_SECRET", "").strip()
    if not api_key:
        row = db.query(models.UserSettings).filter(models.UserSettings.key == "kraken_api_key").first()
        api_key = row.value.strip() if row and row.value else ""
    if not api_secret:
        row = db.query(models.UserSettings).filter(models.UserSettings.key == "kraken_api_secret").first()
        api_secret = row.value.strip() if row and row.value else ""
    if not api_key or not api_secret:
        raise HTTPException(status_code=503, detail="Credenciales de Kraken no configuradas. Define kraken_api_key y kraken_api_secret en Ajustes.")
    return KrakenAPI(api_key=api_key, api_secret=api_secret)


def _kraken_eur_account(db: Session) -> models.Account:
    acc = db.query(models.Account).filter(models.Account.banco == "Kraken").first()
    if not acc:
        acc = models.Account(
            alias_real="Kraken EUR",
            alias_anonimo=f"ACC_{uuid.uuid4().hex[:6].upper()}",
            tipo="fondos",
            balance_actual=0.0,
            banco="Kraken",
        )
        db.add(acc)
        db.commit()
        db.refresh(acc)
    return acc


@router.get("/kraken/balance")
def kraken_balance(db: Session = Depends(get_db)):
    """Fetch live balances from Kraken and return with EUR value."""
    client = _kraken_client(db)
    try:
        raw_balances = client.get_balance()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error de Kraken: {e}")

    crypto_assets = [normalize_asset(a) for a in raw_balances if not is_fiat(a)]
    eur_prices = KrakenAPI.get_eur_prices(crypto_assets)

    result = []
    for raw_asset, amount in raw_balances.items():
        normalized = normalize_asset(raw_asset)
        if is_fiat(raw_asset):
            eur_value = amount if normalized == "EUR" else None
            result.append({"asset": normalized, "amount": round(amount, 8), "eur_value": round(eur_value, 2) if eur_value else None, "type": "fiat"})
        else:
            price = eur_prices.get(normalized)
            eur_value = round(amount * price, 2) if price else None
            result.append({"asset": normalized, "amount": round(amount, 8), "eur_value": eur_value, "eur_price": round(price, 2) if price else None, "type": "crypto"})

    return {"balances": sorted(result, key=lambda x: (x["type"] != "fiat", -(x["eur_value"] or 0)))}


@router.post("/kraken/sync")
def kraken_sync(db: Session = Depends(get_db)):
    """Sync Kraken: update Investment records (crypto) + Account balance (EUR) + import ledger."""
    client = _kraken_client(db)
    try:
        raw_balances = client.get_balance()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error de Kraken: {e}")

    crypto_assets = [normalize_asset(a) for a in raw_balances if not is_fiat(a)]
    eur_prices = KrakenAPI.get_eur_prices(crypto_assets)

    investments_updated = []
    for raw_asset, amount in raw_balances.items():
        normalized = normalize_asset(raw_asset)
        if is_fiat(raw_asset):
            if normalized == "EUR":
                acc = _kraken_eur_account(db)
                acc.balance_actual = round(amount, 2)
                db.commit()
            continue

        price = eur_prices.get(normalized)
        eur_value = round(amount * price, 2) if price else 0.0
        inv_name = f"Kraken {normalized}"
        inv = db.query(models.Investment).filter(models.Investment.nombre == inv_name).first()
        if inv:
            inv.valor_actual = eur_value
        else:
            inv = models.Investment(
                nombre=inv_name,
                monto_invertido=0.0,
                valor_actual=eur_value,
                tipo="crypto",
            )
            db.add(inv)
        investments_updated.append({"asset": normalized, "amount": round(amount, 8), "eur_value": eur_value})

    db.commit()

    # Import ledger entries as transactions
    acc = _kraken_eur_account(db)
    ledger_created = 0
    try:
        ledger_result = client.get_ledgers()
        entries = ledger_result.get("ledger", {})
        LEDGER_CATEGORIES = {
            "deposit": "Depósito Kraken",
            "withdrawal": "Retirada Kraken",
            "trade": "Trade Kraken",
            "staking": "Staking Kraken",
            "dividend": "Dividendo Kraken",
        }
        for refid, entry in entries.items():
            entry_type = entry.get("type", "")
            if entry_type not in LEDGER_CATEGORIES:
                continue
            asset = entry.get("asset", "")
            if not is_fiat(asset):
                continue  # only import EUR/fiat ledger entries as cash transactions
            dedup_key = f"kraken:{refid}"
            existing = db.query(models.Transaction).filter(models.Transaction.gocardless_tx_id == dedup_key).first()
            if existing:
                continue
            amount = float(entry.get("amount", 0))
            if amount == 0:
                continue
            ts = entry.get("time", 0)
            tx_date = datetime.utcfromtimestamp(float(ts)) if ts else datetime.utcnow()
            category = LEDGER_CATEGORIES[entry_type]
            new_tx = models.Transaction(
                account_id=acc.id,
                amount=round(amount, 2),
                category_anon=category,
                description_raw=f"{entry_type.capitalize()} {normalize_asset(asset)}",
                date=tx_date,
                gocardless_tx_id=dedup_key,
            )
            db.add(new_tx)
            # Do not mutate acc.balance_actual here: the live Kraken EUR balance
            # above is already the source of truth and already includes ledger moves.
            ledger_created += 1
        db.commit()
    except Exception as e:
        logger.warning(f"Kraken ledger import error: {e}")

    return {
        "status": "ok",
        "investments_updated": len(investments_updated),
        "ledger_imported": ledger_created,
        "balances": investments_updated,
    }
