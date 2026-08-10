"""Tests for bulk settings endpoint."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_list_settings_bulk_and_filter():
    client.post("/settings/", json={"key": "boot_theme", "value": "night"})
    client.post("/settings/", json={"key": "boot_other", "value": "x"})

    all_res = client.get("/settings/")
    assert all_res.status_code == 200
    body = all_res.json()
    assert body.get("boot_theme") == "night"
    assert body.get("boot_other") == "x"

    filtered = client.get("/settings/?keys=boot_theme,missing_key")
    assert filtered.status_code == 200
    filtered_body = filtered.json()
    assert filtered_body.get("boot_theme") == "night"
    assert "missing_key" not in filtered_body
    assert "boot_other" not in filtered_body


def test_get_setting_by_key_still_works():
    client.post("/settings/", json={"key": "single_key", "value": "1"})
    res = client.get("/settings/single_key")
    assert res.status_code == 200
    assert res.json()["value"] == "1"
