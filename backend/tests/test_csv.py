from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_export_accounts_csv():
    client.post(
        "/accounts/",
        json={
            "alias_real": "CSV Export Test",
            "tipo": "gasto",
            "balance_actual": 42.5,
            "banco": "Test",
        },
    )
    response = client.get("/export-csv/accounts")
    assert response.status_code == 200
    assert "text/csv" in response.headers.get("content-type", "")
    body = response.text
    assert "alias_real" in body
    assert "CSV Export Test" in body


def test_export_csv_bundle_zip():
    client.post(
        "/accounts/",
        json={
            "alias_real": "Bundle Test",
            "tipo": "gasto",
            "balance_actual": 1,
            "banco": "Test",
        },
    )
    response = client.get("/export-csv/bundle")
    assert response.status_code == 200
    assert "application/zip" in response.headers.get("content-type", "")
    assert response.content[:2] == b"PK"
    import zipfile
    import io
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        names = zf.namelist()
        assert any("cuentas" in n for n in names)
        cuentas = next(n for n in names if "cuentas" in n)
        assert b"Bundle Test" in zf.read(cuentas)
