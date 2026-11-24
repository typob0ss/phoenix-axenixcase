import copy
import json

import httpx

from test_api import client, demo, set_provider


def result_content(demo):
    return {key: copy.deepcopy(demo[key]) for key in (
        'title', 'roles', 'steps', 'edges', 'bottlenecks', 'recommendations', 'warnings'
    )}


def test_one_grounding_repair_uses_validation_feedback_and_revalidates(client, demo, monkeypatch):
    valid = result_content(demo)
    invalid = copy.deepcopy(valid)
    invalid['steps'][0]['duration_minutes'] = 137
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            result = invalid
        else:
            assert body['messages'][-2]['role'] == 'assistant'
            feedback = body['messages'][-1]['content']
            assert 'duration_minutes' in feedback
            assert 'null' in feedback
            result = valid
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result, ensure_ascii=False)}}]})

    set_provider(monkeypatch, handler)
    response = client.post('/api/analyze', json={'text': demo['source_text']})
    assert response.status_code == 200, response.text
    assert len(calls) == 2
    assert response.json()['mode'] == 'live'
    assert response.json()['steps'][0]['duration_minutes'] is None
    assert any('исправлен' in w for w in response.json()['warnings'])


def test_repair_is_bounded_and_does_not_accept_forged_quotes(client, demo, monkeypatch):
    invalid = result_content(demo)
    invalid['steps'][0]['quote'] = 'Этой цитаты нет в исходнике'
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(invalid, ensure_ascii=False)}}]})

    set_provider(monkeypatch, handler)
    response = client.post('/api/analyze', json={'text': demo['source_text']})
    assert response.status_code == 502
    assert len(calls) == 2
    assert 'secret-test-token' not in response.text


def test_provider_authentication_failure_is_not_retried(client, demo, monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(401, text='secret-test-token')

    set_provider(monkeypatch, handler)
    response = client.post('/api/analyze', json={'text': demo['source_text']})
    assert response.status_code == 502
    assert len(calls) == 1
    assert 'secret-test-token' not in response.text
