from fastapi.testclient import TestClient

from app.main import app
from app.routers import kraken as kraken_router

client = TestClient(app)


class _FakeKrakenClient:
    def get_balance(self):
        return {
            "ZEUR": 100.0,
        }

    def get_ledgers(self):
        return {
            "ledger": {
                "abc123": {
                    "type": "deposit",
                    "asset": "ZEUR",
                    "amount": "25.0",
                    "time": 1720000000,
                }
            }
        }


def test_kraken_sync_keeps_live_eur_balance_as_source_of_truth(monkeypatch):
    monkeypatch.setattr(kraken_router, "_kraken_client", lambda db: _FakeKrakenClient())
    monkeypatch.setattr(kraken_router.KrakenAPI, "get_eur_prices", staticmethod(lambda assets: {}))

    res = client.post("/kraken/sync")
    assert res.status_code == 200
    body = res.json()
    assert body["ledger_imported"] == 1

    accounts = client.get("/accounts/").json()
    kraken = next(a for a in accounts if a["alias_real"] == "Kraken EUR")
    assert kraken["balance_actual"] == 100.0

    txs = client.get("/transactions/").json()
    kraken_txs = [t for t in txs if t.get("account_id") == kraken["id"]]
    assert any(t.get("amount") == 25.0 for t in kraken_txs)

