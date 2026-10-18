from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "test.sqlite3")
    with TestClient(main.app) as test_client:
        yield test_client


def test_demo_and_user_data_are_separate(client):
    assert len(client.get("/api/reports?dataset=demo").json()["reports"]) == 18
    assert client.get("/api/reports?dataset=user").json()["reports"] == []
    result = client.post("/api/reports", json={"text": "Не работает фонарь"})
    assert result.status_code == 201
    assert result.json()["lat"] is None
    assert result.json()["zone"] == "Место не указано"
    assert result.json()["category"] == "lighting"
    assert len(client.get("/api/reports?dataset=demo").json()["reports"]) == 18
    assert len(client.get("/api/reports?dataset=user").json()["reports"]) == 1


@pytest.mark.parametrize("text,category", [
    ("Не убирают снег возле дома", "snow"),
    ("Переполнен контейнер", "waste"),
    ("Яма на дороге", "roads"),
    ("Не работает ливневая канализация", "drainage"),
])
def test_requested_examples(client, text, category):
    assert client.post("/api/analyze", json={"text": text}).json()["category"] == category


def test_danger_requires_review(client):
    data = client.post("/api/analyze", json={"text": "Открытый люк на дороге"}).json()
    assert data["priority"] == "high"
    assert "подтвердить" in data["reasons"][0]


def test_import_is_atomic(client):
    data = 'text,lat,lon\nНе горит фонарь,56.66,124.71\nЯма на дороге,0,0\n'
    result = client.post("/api/import", json={"csv": data})
    assert result.status_code == 400
    assert client.get("/api/reports?dataset=user").json()["reports"] == []


def test_coordinate_pair_and_future_date(client):
    assert client.post("/api/reports", json={"text": "Не горит фонарь", "lat": 56.66}).status_code == 422
    assert client.post("/api/reports", json={"text": "Не горит фонарь", "created_at": (main.now() + timedelta(days=1)).isoformat()}).status_code == 422


def test_status_and_missing_report(client):
    report = client.post("/api/reports", json={"text": "Не горит фонарь"}).json()
    result = client.patch(f"/api/reports/{report['id']}", json={"status": "resolved", "category": "lighting"})
    assert result.json()["status"] == "resolved"
    assert client.patch("/api/reports/99999", json={"status": "resolved"}).status_code == 404


def test_forecast_not_invented_for_short_history(client):
    assert client.get("/api/analytics?dataset=demo").json()["forecasts"] == []
    assert client.get("/api/analytics?dataset=user").json()["forecasts"] == []


def test_history_enables_explicit_baseline(client):
    rows = ["text,created_at"]
    for day in range(32):
        rows.append(f"Не работает фонарь,{(main.now() - timedelta(days=day)).isoformat()}")
    assert client.post("/api/import", json={"csv": "\n".join(rows)}).json()["imported"] == 32
    analytics = client.get("/api/analytics?dataset=user").json()
    forecast = next(item for item in analytics["forecasts"] if item["category"] == "lighting")
    assert forecast["expected"] == 7
    assert not analytics["evaluation"]["available"]
    assert "Для проверки точности пока недостаточно истории" in analytics["forecast_note"]


def test_forecast_note_matches_available_historical_evaluation(client):
    rows = ["text,created_at"]
    for day in range(1, 71):
        rows.append(f"Не работает фонарь,{(main.now() - timedelta(days=day)).isoformat()}")
    assert client.post("/api/import", json={"csv": "\n".join(rows)}).json()["imported"] == 70
    analytics = client.get("/api/analytics?dataset=user").json()
    assert analytics["evaluation"]["available"]
    assert "Ошибка на прошлых данных показана ниже" in analytics["forecast_note"]
    assert "Точность на будущих обращениях пока не проверена" in analytics["forecast_note"]
    assert "недостаточно истории" not in analytics["forecast_note"]


def test_forecast_uses_completed_days_and_ignores_today(client):
    rows = ["text,created_at"]
    for day in range(1, 33):
        rows.append(f"Не работает фонарь,{(main.now() - timedelta(days=day)).isoformat()}")
    assert client.post("/api/import", json={"csv": "\n".join(rows)}).status_code == 200
    before = client.get("/api/analytics?dataset=user").json()
    for _ in range(8):
        assert client.post("/api/reports", json={"text": "Не работает фонарь"}).status_code == 201
    after = client.get("/api/analytics?dataset=user").json()
    assert after["forecasts"] == before["forecasts"]
    assert after["sector_forecasts"] == before["sector_forecasts"]
    assert next(f for f in after["forecasts"] if f["category"] == "lighting")["expected"] == 7
    assert after["days"][-1]["count"] == 8


def test_partial_day_does_not_complete_forecast_or_evaluation_history(client):
    rows = ["text,created_at"]
    for day in range(28):
        for _ in range(3):
            rows.append(f"Не работает фонарь,{(main.now() - timedelta(days=day)).isoformat()}")
    assert client.post("/api/import", json={"csv": "\n".join(rows)}).status_code == 200
    data = client.get("/api/analytics?dataset=user").json()
    assert data["coverage_days"] == 27
    assert data["forecasts"] == []
    rows = ["text,created_at", f"Не работает фонарь,{(main.now() - timedelta(days=55)).isoformat()}"]
    assert client.post("/api/import", json={"csv": "\n".join(rows)}).status_code == 200
    assert not client.get("/api/analytics?dataset=user").json()["evaluation"]["available"]


def test_cross_origin_write_rejected(client):
    assert client.post("/api/reports", json={"text": "Не горит фонарь"}, headers={"origin": "https://example.com"}).status_code == 403


def test_export_formula_protection(client):
    client.post("/api/reports", json={"text": '=HYPERLINK("example")'})
    result = client.get("/api/export.csv?dataset=user")
    assert "'=HYPERLINK" in result.text


def test_nearby_reports_are_suggestions_not_merged(client):
    first = client.post("/api/reports", json={"text": "Не работает фонарь", "lat": 56.66, "lon": 124.71}).json()
    second = client.post("/api/reports", json={"text": "Не работает фонарь", "lat": 56.6601, "lon": 124.7101}).json()
    matches = client.get(f"/api/similar/{first['id']}").json()["matches"]
    assert matches[0]["id"] == second["id"]
    assert len(client.get("/api/reports?dataset=user").json()["reports"]) == 2


@pytest.mark.parametrize("csv_text", [
    'text\nНе работает фонарь, провод лежит на земле\n',
    'text,address,lat,lon\nНе работает фонарь\n',
    'text,text\nНе работает фонарь,Асфальт провалился\n',
    'text, text\nНе работает фонарь,Асфальт провалился\n',
    'text\n"Не работает фонарь\n',
    'text\n' + 'а' * 140_000 + '\n',
], ids=["extra-cell", "missing-cells", "duplicate-header", "spaced-duplicate", "unclosed-quote", "oversized-field"])
def test_malformed_csv_is_rejected_without_data_loss(client, csv_text):
    result = client.post("/api/import", json={"csv": csv_text})
    assert result.status_code == 400
    assert "detail" in result.json()
    assert client.get("/api/reports?dataset=user").json()["reports"] == []


def test_shape_error_rolls_back_previous_valid_rows(client):
    data = 'text,lat,lon\nНе горит фонарь,56.66,124.71\nПровод лежит на земле\n'
    result = client.post("/api/import", json={"csv": data})
    assert result.status_code == 400
    assert "Строка 3" in result.json()["detail"]
    assert client.get("/api/reports?dataset=user").json()["reports"] == []


@pytest.mark.parametrize("delimiter", [",", ";", "\t"])
def test_quoted_csv_preserves_complete_message(client, delimiter):
    import csv
    import io

    text = 'Не работает фонарь, провод лежит на земле;\nвозле дома "тест".'
    stream = io.StringIO()
    writer = csv.writer(stream, delimiter=delimiter)
    writer.writerow(["text", "address", "lat", "lon"])
    writer.writerow([text, "Учебное место", "", ""])
    result = client.post("/api/import", json={"csv": stream.getvalue()})
    assert result.status_code == 200
    report = client.get("/api/reports?dataset=user").json()["reports"][0]
    assert report["text"] == text
    assert report["priority"] == "high"
    assert report["lat"] is None


def test_demo_export_cannot_be_reimported_as_user_data(client):
    exported = client.get("/api/export.csv?dataset=demo").text
    result = client.post("/api/import", json={"csv": exported})
    assert result.status_code == 400
    assert "учебные обращения" in result.json()["detail"]
    assert client.get("/api/reports?dataset=user").json()["reports"] == []
    assert len(client.get("/api/reports?dataset=demo").json()["reports"]) == 18


def test_user_export_remains_importable(client):
    client.post("/api/reports", json={"text": "Не работает фонарь"})
    exported = client.get("/api/export.csv?dataset=user").text
    result = client.post("/api/import", json={"csv": exported})
    assert result.status_code == 200
    assert result.json()["imported"] == 1


def test_demo_marker_in_later_row_prevents_partial_import(client):
    result = client.post("/api/import", json={"csv": "text,demo\nНе работает фонарь,false\nОткрытый люк,True\n"})
    assert result.status_code == 400
    assert client.get("/api/reports?dataset=user").json()["reports"] == []


@pytest.mark.parametrize("text", [
    "Асфальт провалился", "Провал асфальта", "Дорога провалилась", "Провалилась дорога",
    "Оборванный провод лежит у дома", "Провод оборван у дома",
    "Люк открыт возле дома", "Открытый люк возле дома",
])
def test_danger_rules_handle_word_order(client, text):
    result = client.post("/api/analyze", json={"text": text}).json()
    assert result["priority"] == "high"
    assert "подтвердить" in result["reasons"][0]
