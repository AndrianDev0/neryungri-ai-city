from datetime import timedelta

from app import main
from app.evaluation import evaluate_baseline
from test_api import client


def report(client, **extra):
    response = client.post('/api/reports', json={'text': 'Не горит фонарь', 'category': 'lighting', **extra})
    assert response.status_code == 201
    return response.json()


def link(client, source, target, kind='duplicate'):
    return client.put(f"/api/reports/{source['id']}/relation", json={'target_id': target['id'], 'kind': kind})


def test_duplicates_group_counts_status_and_unlink(client):
    a, b = report(client), report(client, text='Фонарь искрит')
    assert link(client, b, a).status_code == 200
    rows = client.get('/api/reports?dataset=user').json()['reports']
    assert {r['problem_id'] for r in rows} == {a['id']}
    assert {r['priority'] for r in rows} == {'high'}
    assert {r['problem_report_count'] for r in rows} == {2}
    data = client.get('/api/analytics?dataset=user').json()
    assert (data['problems'], data['duplicate_reports']) == (1, 1)
    client.patch(f"/api/reports/{b['id']}", json={'status': 'in_progress'})
    assert {r['status'] for r in client.get('/api/reports?dataset=user').json()['reports']} == {'in_progress'}
    assert client.delete(f"/api/reports/{b['id']}/relation").status_code == 200
    assert client.get('/api/analytics?dataset=user').json()['problems'] == 2
    assert len(client.get('/api/reports?dataset=user').json()['reports']) == 2


def test_invalid_links_and_group_merge_rejected(client):
    a, b, c = report(client), report(client), report(client)
    assert link(client, a, a).status_code == 400
    assert link(client, a, {'id': 99999}).status_code == 404
    demo = next(r for r in client.get('/api/reports?dataset=demo').json()['reports'] if r['category'] == 'lighting')
    assert link(client, a, demo).status_code == 400
    roads = report(client, category='roads')
    assert link(client, a, roads).status_code == 400
    assert link(client, b, a).status_code == 200
    assert link(client, a, c).status_code == 409
    assert link(client, a, b).status_code == 400


def test_recurrence_requires_confirmed_repair_and_later_report(client, monkeypatch):
    base = main.now()
    monkeypatch.setattr(main, 'now', lambda: base)
    a, early = report(client), report(client)
    assert link(client, early, a, 'recurrence').status_code == 400
    assert client.patch(f"/api/reports/{a['id']}", json={'status': 'resolved', 'repair_confirmed': True}).status_code == 400
    assert client.patch(f"/api/reports/{a['id']}", json={'status': 'resolved', 'repair_confirmed': True, 'resolution_note': 'Проверено включение после ремонта'}).status_code == 200
    assert link(client, early, a, 'recurrence').status_code == 400
    assert link(client, early, a).status_code == 400
    monkeypatch.setattr(main, 'now', lambda: base + timedelta(days=1))
    later = report(client)
    assert link(client, later, a, 'recurrence').status_code == 200
    assert client.get('/api/analytics?dataset=user').json()['recurrences'] == 1
    assert client.patch(f"/api/reports/{a['id']}", json={'status': 'new', 'repair_confirmed': False}).status_code == 409
    assert client.patch(f"/api/reports/{later['id']}", json={'category': 'roads'}).status_code == 409
    # Old reports cannot become duplicates of a post-repair recurrence.
    assert link(client, early, later).status_code == 400
    copy = report(client)
    assert link(client, copy, later).status_code == 200
    assert client.get('/api/analytics?dataset=user').json()['recurrences'] == 1
    assert client.delete(f"/api/reports/{later['id']}/relation").status_code == 200
    assert client.get('/api/analytics?dataset=user').json()['recurrences'] == 0
    assert client.patch(f"/api/reports/{a['id']}", json={'status': 'new', 'repair_confirmed': False}).status_code == 200


def test_migration_is_idempotent_and_does_not_invent_repair_dates(client):
    main.init_db()
    main.init_db()
    rows = client.get('/api/reports?dataset=demo').json()['reports']
    assert len(rows) == 18
    assert all(r['problem_id'] == r['id'] for r in rows)
    assert all(r['resolved_at'] is None and not r['repair_confirmed'] for r in rows)


def test_old_schema_upgrade_preserves_existing_report(tmp_path, monkeypatch):
    import sqlite3
    import json
    db_path = tmp_path / 'legacy.sqlite3'
    monkeypatch.setattr(main, 'DB_PATH', db_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT,text TEXT,address TEXT,lat REAL,lon REAL,category TEXT,priority TEXT,status TEXT,created_at TEXT,demo INTEGER,analysis TEXT)")
        db.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT)")
        db.execute("INSERT INTO metadata VALUES ('demo_seeded','1')")
        db.execute("INSERT INTO reports VALUES (42,?,'',NULL,NULL,'lighting','normal','resolved',?,0,?)",
                   ('Существующая запись', main.now().isoformat(), json.dumps(main.analyze('Не горит фонарь'))))
    main.init_db()
    main.init_db()
    rows = main.read_reports('user')
    assert len(rows) == 1 and rows[0]['id'] == rows[0]['problem_id'] == 42
    assert rows[0]['text'] == 'Существующая запись'
    assert rows[0]['resolved_at'] is None and not rows[0]['repair_confirmed']


def test_evaluation_uses_past_only_and_compares_baselines():
    today = main.now().date()
    dates = [today - timedelta(days=d) for d in range(1, 71)]
    result = evaluate_baseline(dates, today, 70)
    assert result['available'] and result['mae'] == result['previous_week_mae'] == 0
    assert all(w['actual'] == 7 and w['expected'] == 7 for w in result['windows'])
    # Today's spike must not leak into historical training or actuals.
    assert evaluate_baseline(dates + [today] * 100, today, 70) == result
    dates += [today - timedelta(days=1)] * 8
    result = evaluate_baseline(dates, today, 70)
    assert result['windows'][-1]['actual'] == 15
    assert result['windows'][-1]['expected'] == 7
    assert result['mae'] == 2
    assert not evaluate_baseline(dates, today, 27)['available']


def test_sector_counts_use_primary_location_and_forecast_units(client):
    a = report(client, lat=56.67, lon=124.70)
    b = report(client, lat=56.65, lon=124.73)
    assert link(client, b, a).status_code == 200
    data = client.get('/api/analytics?dataset=user').json()
    assert data['sectors'] == [{'zone': 'Север / запад', 'problems': 1, 'reports': 2, 'recurrences': 0, 'open': 1}]
    assert not data['evaluation']['available']
    assert data['sector_forecasts'] == []
