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


def test_repeated_unsupported_metrics_are_removed_with_warning_after_repair(client, demo, monkeypatch):
    generated = result_content(demo)
    generated['steps'][0]['duration_minutes'] = 137
    generated['bottlenecks'][0]['time_minutes'] = 137
    generated['bottlenecks'][0]['cost_rub'] = 137
    generated['recommendations'][0]['estimated_saving_minutes'] = 137
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(generated, ensure_ascii=False)}}]})

    set_provider(monkeypatch, handler)
    response = client.post('/api/analyze', json={'text': demo['source_text']})
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(calls) == 2
    assert result['steps'][0]['duration_minutes'] is None
    assert result['bottlenecks'][0]['time_minutes'] is None
    assert result['bottlenecks'][0]['cost_rub'] is None
    assert result['recommendations'][0]['estimated_saving_minutes'] is None
    assert result['steps'][0]['quote'] == generated['steps'][0]['quote']
    assert result['steps'][1:] == generated['steps'][1:]
    assert any('численные' in w.lower() and 'убраны' in w.lower() for w in result['warnings'])
    # User edits still use strict validation and cannot reintroduce the false value.
    result['steps'][0]['duration_minutes'] = 137
    assert client.post('/api/validate', json=result).status_code == 422


def test_metric_fallback_does_not_bypass_quotes_or_references(client, demo, monkeypatch):
    generated = result_content(demo)
    generated['steps'][0]['duration_minutes'] = 137
    generated['steps'][0]['quote'] = 'Этой цитаты нет в исходнике'
    set_provider(monkeypatch, lambda request: httpx.Response(200, json={
        'choices': [{'message': {'content': json.dumps(generated, ensure_ascii=False)}}]
    }))
    assert client.post('/api/analyze', json={'text': demo['source_text']}).status_code == 502
    generated['steps'][0]['quote'] = demo['steps'][0]['quote']
    generated['steps'][0]['role_id'] = 'missing-role'
    assert client.post('/api/analyze', json={'text': demo['source_text']}).status_code == 502


def test_metric_fallback_preserves_supported_measurements(client, monkeypatch):
    example = next(ex for ex in client.get('/api/examples').json() if ex['id'] == 'retail')
    demo_result = client.post('/api/analyze', json={'text': example['text'], 'demo_id': 'retail'}).json()
    generated = result_content(demo_result)
    # A model may mistake an approximate value for an exact measurement.
    approximate = 'Проверка бюджета занимает около 10 минут.'
    generated['steps'][0]['quote'] = approximate
    generated['steps'][0]['duration_minutes'] = 10
    set_provider(monkeypatch, lambda request: httpx.Response(200, json={
        'choices': [{'message': {'content': json.dumps(generated, ensure_ascii=False)}}]
    }))
    response = client.post('/api/analyze', json={'text': example['text'] + '\n' + approximate})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['steps'][0]['duration_minutes'] is None
    assert result['steps'][0]['quote'] == approximate
    assert result['bottlenecks'] == generated['bottlenecks']
    assert result['recommendations'] == generated['recommendations']
    assert any(item['time_minutes'] is not None for item in result['bottlenecks'])
    assert any(item['estimated_saving_minutes'] is not None for item in result['recommendations'])


def test_repair_receives_all_bad_quotes_and_exact_source_fragments(client, demo, monkeypatch):
    valid = result_content(demo)
    invalid = copy.deepcopy(valid)
    targets = [('steps', 0), ('bottlenecks', 0)]
    for group, index in targets:
        # Mimic the observed model appending punctuation for presentation.
        invalid[group][index]['quote'] = valid[group][index]['quote'] + '!'
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            result = invalid
        else:
            feedback = body['messages'][-1]['content']
            for group, index in targets:
                assert invalid[group][index]['quote'] in feedback
                assert valid[group][index]['quote'] in feedback
                assert invalid[group][index]['id'] in feedback
            result = valid
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result, ensure_ascii=False)}}]})

    set_provider(monkeypatch, handler)
    response = client.post('/api/analyze', json={'text': demo['source_text']})
    assert response.status_code == 200, response.text
    assert response.json()['steps'][0]['quote'] == valid['steps'][0]['quote']
    assert len(calls) == 2


def test_quote_repair_diagnostics_preserve_supported_numbers(client, monkeypatch):
    example = next(ex for ex in client.get('/api/examples').json() if ex['id'] == 'retail')
    demo_result = client.post('/api/analyze', json={'text': example['text'], 'demo_id': 'retail'}).json()
    valid = result_content(demo_result)
    invalid = copy.deepcopy(valid)
    invalid['bottlenecks'][0]['quote'] += '!'
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        result = invalid if len(calls) == 1 else valid
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result, ensure_ascii=False)}}]})

    set_provider(monkeypatch, handler)
    response = client.post('/api/analyze', json={'text': example['text']})
    assert response.status_code == 200, response.text
    assert response.json()['bottlenecks'][0]['time_minutes'] == 6
    assert response.json()['bottlenecks'][0]['cost_rub'] == 90
    feedback = json.loads(calls[1]['messages'][-1]['content'].split('Диагностика проверки: ')[1])
    issues = [issue for issue in feedback if issue.get('id') == valid['bottlenecks'][0]['id']]
    assert any(issue['loc'][-1] == 'quote' for issue in issues)
    assert not any(issue['loc'][-1] in ('time_minutes', 'cost_rub') for issue in issues)
