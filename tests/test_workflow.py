import io
from datetime import timedelta

import pytest
from PIL import Image
from app import main
from test_api import client


def create(client, **fields):
    return client.post('/api/reports', json={'text': 'Не работает фонарь', 'category': 'lighting', **fields}).json()


@pytest.mark.parametrize('text,priority', [
    ('Открытый люк уже закрыли, проблема решена.', 'normal'),
    ('Фонарь не искрит', 'normal'),
    ('Открытый люк не закрыли', 'high'),
    ('Люк закрыли, но провод искрит', 'high'),
    ('Люк закрыли и провод лежит на земле', 'high'),
])
def test_context_priority(client, text, priority):
    assert client.post('/api/analyze', json={'text': text}).json()['priority'] == priority


def test_multitopic_split_atomic_and_traceable(client):
    text = 'Не работает фонарь и переполнен контейнер возле дома'
    result = client.post('/api/analyze', json={'text': text}).json()
    assert {x['category'] for x in result['suggestions']} == {'lighting', 'waste'}
    payload = {'text': text, 'parts': [{'text': x['text']} for x in result['suggestions']],
               'categories': [x['category'] for x in result['suggestions']], 'lat': 56.66, 'lon': 124.71}
    bad = {**payload, 'categories': ['lighting', 'lighting']}
    assert client.post('/api/reports/split', json=bad).status_code == 422
    assert not client.get('/api/reports?dataset=user').json()['reports']
    response = client.post('/api/reports/split', json=payload)
    assert response.status_code == 201
    records = response.json()['reports']
    assert len(records) == 2
    assert len({r['bundle_id'] for r in records}) == 1
    assert len({r['problem_id'] for r in records}) == 2
    assert all(r['source_text'] == text and r['lat'] == 56.66 for r in records)


def test_group_assignment_local_location_and_history(client):
    first, second = create(client), create(client)
    client.patch(f"/api/reports/{first['id']}", json={'assignee': 'Бригада 2', 'due_date': '2026-01-01'})
    assert client.put(f"/api/reports/{second['id']}/relation", json={'target_id': first['id'], 'kind': 'duplicate'}).status_code == 200
    updated = client.patch(f"/api/reports/{second['id']}", json={'assignee': 'Бригада 3', 'address': 'Уточнённый ориентир', 'lat': 56.66, 'lon': 124.71})
    assert updated.status_code == 200
    reports = {r['id']: r for r in client.get('/api/reports?dataset=user').json()['reports']}
    assert reports[first['id']]['address'] == ''
    assert reports[first['id']]['lat'] is None
    assert reports[first['id']]['assignee'] == 'Бригада 3'
    assert reports[second['id']]['due_date'] == '2026-01-01'
    events = client.get(f"/api/reports/{second['id']}/history").json()['events']
    assert events[0]['changes']['assignee'] == {'before': 'Бригада 2', 'after': 'Бригада 3'}
    assert any(e['action'] == 'Связь: дубль' for e in events)
    assert client.get('/api/analytics?dataset=user').json()['overdue_problems'] == 1
    cleared = client.patch(f"/api/reports/{second['id']}", json={'lat': None, 'lon': None, 'due_date': None})
    assert cleared.status_code == 200 and cleared.json()['due_date'] is None and cleared.json()['lat'] is None
    assert client.patch(f"/api/reports/{second['id']}", json={'lat': 56.66}).status_code == 422
    assert client.patch(f"/api/reports/{second['id']}", json={'lat': 0, 'lon': 0}).status_code == 422
    assert client.patch(f"/api/reports/{second['id']}", json={'status': None}).status_code == 422


def test_photo_validation_metadata_and_scope(client):
    first, second = create(client), create(client)
    path = f"/api/reports/{first['id']}/photos?phase=before"
    assert client.post(path, content=b'<svg></svg>').status_code == 400
    assert client.post(path, content=b'x' * 5_000_001).status_code == 413
    buffer = io.BytesIO()
    Image.new('RGB', (80, 60), '#eef2f6').save(buffer, 'PNG')
    added = client.post(path, content=buffer.getvalue())
    assert added.status_code == 201
    photo_id = added.json()['id']
    content = client.get(f'/api/photos/{photo_id}')
    assert content.headers['content-type'] == 'image/jpeg'
    assert Image.open(io.BytesIO(content.content)).getexif() == {}
    assert client.delete(f"/api/reports/{second['id']}/photos/{photo_id}").status_code == 404
    assert client.delete(f"/api/reports/{first['id']}/photos/{photo_id}").status_code == 200
    assert client.get(f'/api/photos/{photo_id}').status_code == 404
    assert len(client.get(f"/api/reports/{first['id']}/history").json()['events']) == 2


def test_due_today_not_overdue_and_resolved_not_overdue(client):
    report = create(client)
    path = f"/api/reports/{report['id']}"
    client.patch(path, json={'due_date': main.now().date().isoformat()})
    assert client.get('/api/analytics?dataset=user').json()['overdue_problems'] == 0
    client.patch(path, json={'due_date': (main.now().date()-timedelta(days=1)).isoformat()})
    assert client.get('/api/analytics?dataset=user').json()['overdue_problems'] == 1
    client.patch(path, json={'status': 'resolved'})
    assert client.get('/api/analytics?dataset=user').json()['overdue_problems'] == 0


def test_edit_old_resolved_address_does_not_invent_repair_date(client):
    report = next(r for r in client.get('/api/reports?dataset=demo').json()['reports'] if r['status'] == 'resolved')
    updated = client.patch(f"/api/reports/{report['id']}", json={'address': 'Уточнённый адрес'})
    assert updated.status_code == 200
    assert updated.json()['resolved_at'] is None
