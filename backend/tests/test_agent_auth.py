"""SOBERAN_API_KEY, when set, must gate the whole /agent/* surface (not just iCal)."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_agent_endpoints_open_when_no_api_key_configured(monkeypatch):
    monkeypatch.delenv("SOBERAN_API_KEY", raising=False)
    assert client.get("/agent/commands").status_code == 200
    assert client.get("/api/agent/context").status_code == 200


def test_agent_endpoints_reject_missing_or_wrong_key(monkeypatch):
    monkeypatch.setenv("SOBERAN_API_KEY", "correct-key")
    try:
        assert client.get("/agent/commands").status_code == 401
        assert client.get("/agent/commands", headers={"X-Api-Key": "wrong"}).status_code == 401
        assert client.get("/agent/commands?token=wrong").status_code == 401
    finally:
        monkeypatch.delenv("SOBERAN_API_KEY", raising=False)


def test_agent_endpoints_accept_header_or_query_token(monkeypatch):
    monkeypatch.setenv("SOBERAN_API_KEY", "correct-key")
    try:
        assert client.get("/agent/commands", headers={"X-Api-Key": "correct-key"}).status_code == 200
        assert client.get("/agent/commands?token=correct-key").status_code == 200
    finally:
        monkeypatch.delenv("SOBERAN_API_KEY", raising=False)


def test_agent_transaction_write_is_gated_too(monkeypatch):
    monkeypatch.setenv("SOBERAN_API_KEY", "correct-key")
    payload = {
        "cuenta_alias": "ACC_DOESNOTEXIST",
        "monto": -10.0,
        "categoria": "Varios",
        "descripcion": "test",
    }
    try:
        res = client.post("/agent/transaction", json=payload)
        assert res.status_code == 401
    finally:
        monkeypatch.delenv("SOBERAN_API_KEY", raising=False)
