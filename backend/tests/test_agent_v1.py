"""API para asistentes de ágora (/agent/v1, SOBERAN_AGENT_TOKEN)."""
import pytest
from fastapi.testclient import TestClient

from app import models
from app.database import SessionLocal
from app.main import app

client = TestClient(app)
TOKEN = "s" * 40
H = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture()
def on(monkeypatch):
    monkeypatch.setenv("SOBERAN_AGENT_TOKEN", TOKEN)
    db = SessionLocal()
    acc = models.Account(alias_real="Cuenta Agente", alias_anonimo="ACC_AGENTE", banco="BancoTest", tipo="corriente", balance_actual=1000.0)
    db.add(acc)
    db.commit()
    yield acc.id
    db.query(models.Transaction).filter_by(account_id=acc.id).delete()
    db.delete(db.get(models.Account, acc.id))
    db.commit()
    db.close()


def call(tool, args=None):
    return client.post(f"/agent/v1/call/{tool}", json=args or {}, headers=H)


def test_closed_without_token(monkeypatch):
    monkeypatch.delenv("SOBERAN_AGENT_TOKEN", raising=False)
    assert client.get("/agent/v1/manifest", headers=H).status_code == 404
    monkeypatch.setenv("SOBERAN_AGENT_TOKEN", TOKEN)
    assert client.get("/agent/v1/manifest", headers={"Authorization": "Bearer otro-token-cualquiera-largo"}).status_code == 401


def test_old_api_key_does_not_open_v1(monkeypatch):
    monkeypatch.setenv("SOBERAN_API_KEY", "clave-antigua-de-openclaw")
    monkeypatch.delenv("SOBERAN_AGENT_TOKEN", raising=False)
    assert client.get("/agent/v1/manifest", headers={"Authorization": "Bearer clave-antigua-de-openclaw"}).status_code == 404


def test_read_and_write(on):
    tools = {t["name"]: t["write"] for t in client.get("/agent/v1/manifest", headers=H).json()["tools"]}
    assert tools["anadir_movimiento"] and not tools["cuentas"]
    assert any(c["nombre"] == "Cuenta Agente" for c in call("cuentas").json()["result"]["cuentas"])
    r = call("anadir_movimiento", {"cuenta": "cuenta agente", "importe": -12.5, "categoria": "supermercado", "concepto": "Mercadona"})
    assert r.status_code == 200, r.text
    assert r.json()["result"]["categoria"] == "Alimentación"
    movs = call("movimientos", {"texto": "mercadona", "cuenta": "BancoTest"}).json()["result"]
    assert movs["suma"] == -12.5
    assert call("gasto_del_mes").json()["result"]["por_categoria"].get("Alimentación", 0) >= 12.5
    assert call("anadir_movimiento", {"cuenta": "cuenta agente", "importe": -1, "categoria": "Inventada", "concepto": "x"}).status_code == 400
    assert call("anadir_movimiento", {"cuenta": "nadie", "importe": -1, "categoria": "Ocio", "concepto": "x"}).status_code == 404
    for tool in ("deudas", "objetivos", "suscripciones", "patrimonio", "categorias", "presupuesto"):
        assert call(tool).status_code == 200, (tool, call(tool).text)

def test_avisos(on):
    db = SessionLocal()
    for i in range(3):
        db.add(models.Account(alias_real=f"Hucha {i}", alias_anonimo=f"ACC_H{i}", banco="BancoAvisos", tipo="ahorro",
                              balance_actual=0, last_sync_error="GoCardless ha limitado las peticiones (429)"))
    db.commit()
    try:
        av = [a for a in call("avisos").json()["result"] if a["texto"].startswith("BancoAvisos")]
        assert len(av) == 1 and "3 cuenta(s)" in av[0]["texto"] and "límite de peticiones" in av[0]["texto"]
    finally:
        db.query(models.Account).filter_by(banco="BancoAvisos").delete()
        db.commit()
        db.close()
