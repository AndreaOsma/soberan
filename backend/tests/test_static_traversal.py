from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.desktop import mount_desktop_static


def test_spa_fallback_does_not_escape_static_dir(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html>spa</html>")
    (static / "icon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("SECRETO")

    app = FastAPI()
    mount_desktop_static(app, static)
    client = TestClient(app)

    assert client.get("/icon.svg").text == "<svg/>"
    for path in ("/..%2fsecret.txt", "/%2e%2e/secret.txt", "/..%2f..%2f..%2fetc%2fpasswd"):
        resp = client.get(path)
        assert "SECRETO" not in resp.text
        assert resp.text == "<html>spa</html>"
