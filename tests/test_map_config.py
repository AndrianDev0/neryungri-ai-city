import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def settings(tmp_path, monkeypatch):
    path = tmp_path / "config.local.toml"
    monkeypatch.setattr(main, "MAP_CONFIG_PATH", path)
    monkeypatch.delenv("NERYUNGRI_YANDEX_MAPS_API_KEY", raising=False)
    # No database or model is needed for public map configuration.
    return path, TestClient(main.app)


def test_missing_key_keeps_app_configuration_available(settings):
    _, client = settings
    response = client.get("/api/map-config")
    assert response.status_code == 200
    assert response.json() == {"provider": "yandex", "api_key": ""}
    assert response.headers["cache-control"] == "no-store"


def test_loopback_link_redirects_to_authorized_map_origin(settings):
    _, client = settings
    response = client.get("http://127.0.0.1:8765/?from=bookmark", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "http://localhost:8765/?from=bookmark"
    assert client.get("http://localhost:8765/").status_code == 200


def test_local_settings_reload_without_exposing_other_values(settings):
    path, client = settings
    path.write_text('yandex_maps_api_key = "key-one"\nprivate_setting = "not-for-browser"', encoding="utf-8-sig")
    assert client.get("/api/map-config").json() == {"provider": "yandex", "api_key": "key-one"}
    path.write_text('yandex_maps_api_key = "key-two"', encoding="utf-8")
    assert client.get("/api/map-config").json()["api_key"] == "key-two"


def test_environment_key_overrides_file(settings, monkeypatch):
    path, client = settings
    path.write_text('yandex_maps_api_key = "file-key"', encoding="utf-8")
    monkeypatch.setenv("NERYUNGRI_YANDEX_MAPS_API_KEY", " env-key ")
    assert client.get("/api/map-config").json()["api_key"] == "env-key"


@pytest.mark.parametrize("content", ['yandex_maps_api_key = 123', 'yandex_maps_api_key = "unterminated'])
def test_invalid_settings_show_actionable_error(settings, content):
    path, client = settings
    path.write_text(content, encoding="utf-8")
    response = client.get("/api/map-config")
    assert response.status_code == 400
    assert "config.local.toml" in response.json()["detail"]
    assert "unterminated" not in response.text
