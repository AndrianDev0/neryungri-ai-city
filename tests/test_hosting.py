import re

import pytest
from fastapi.testclient import TestClient

from app import main
from scripts.build_pages import build


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "hosting.sqlite3")
    monkeypatch.setenv("NERYUNGRI_WRITE_TOKEN", "x" * 40)
    monkeypatch.setenv("NERYUNGRI_PUBLIC", "1")
    main.ALLOWED_ORIGINS.append("https://andriandev0.github.io")
    try:
        with TestClient(main.app) as client:
            yield client
    finally:
        main.ALLOWED_ORIGINS.remove("https://andriandev0.github.io")


def test_public_site_blocks_edits_without_owner_code(client):
    headers = {"Origin": "https://andriandev0.github.io"}
    response = client.post("/api/reports", headers=headers, json={"text": "Не горит фонарь"})
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == headers["Origin"]
    headers["Authorization"] = "Bearer " + "x" * 40
    assert client.post("/api/reports", headers=headers, json={"text": "Не горит фонарь"}).status_code == 201
    assert client.get("/api/reports?dataset=user").json()["reports"][0]["text"] == "Не горит фонарь"
    headers["Origin"] = "https://unrelated.example"
    assert client.post("/api/reports", headers=headers, json={"text": "Не горит фонарь"}).status_code == 403


def test_preflight_read_and_analysis_work_from_pages(client):
    response = client.options("/api/reports", headers={
        "Origin": "https://andriandev0.github.io",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert response.status_code == 200
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/meta").json()["temporary_storage"] is True
    assert client.post("/api/analyze", json={"text": "Не работает фонарь"}).status_code == 200


def test_public_startup_requires_owner_code(monkeypatch):
    monkeypatch.setenv("NERYUNGRI_PUBLIC", "1")
    monkeypatch.delenv("NERYUNGRI_WRITE_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="NERYUNGRI_WRITE_TOKEN"):
        with TestClient(main.app):
            pass


def test_pages_build_contains_only_client_files(tmp_path):
    build("https://city.example", tmp_path)
    html = (tmp_path / "index.html").read_text(encoding="utf-8")
    for path in re.findall(r'(?:src|href)="(static/[^"?]+)', html):
        assert (tmp_path / path).is_file()
    assert '"apiBase": "https://city.example"' in (tmp_path / "static/config.js").read_text()
    assert not list(tmp_path.rglob("*.sqlite3"))
    assert not list(tmp_path.rglob("*.toml"))
    assert not list(tmp_path.rglob("*.docx"))
    with pytest.raises(ValueError):
        build("http://localhost:8765", tmp_path / "invalid")


def test_pages_versions_scripts_to_replace_cached_clients(tmp_path):
    build("https://city.example", tmp_path)
    before = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert re.search(r'src="static/connection.js\?v=[0-9a-f]{12}"', before)
    old_config = re.search(r'src="static/config.js\?v=([0-9a-f]+)"', before)[1]
    build("https://second.example", tmp_path)
    after = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert re.search(r'src="static/config.js\?v=([0-9a-f]+)"', after)[1] != old_config
