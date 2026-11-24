import copy
import json

import httpx
import pytest

from test_api import client, demo, set_provider


def generated_content(demo):
    return {key: copy.deepcopy(demo[key]) for key in (
        'title', 'roles', 'steps', 'edges', 'bottlenecks', 'recommendations', 'warnings'
    )}


def install(monkeypatch, generated):
    set_provider(monkeypatch, lambda request: httpx.Response(200, json={
        'choices': [{'message': {'content': json.dumps(generated, ensure_ascii=False)}}]
    }))


@pytest.mark.parametrize('collection', ['steps', 'edges', 'bottlenecks', 'recommendations'])
def test_live_quote_with_unique_case_only_match_is_restored_verbatim(client, demo, monkeypatch, collection):
    generated = generated_content(demo)
    original = generated[collection][0]['quote']
    generated[collection][0]['quote'] = original.swapcase()
    assert generated[collection][0]['quote'] not in demo['source_text']
    assert demo['source_text'].lower().count(original.lower()) == 1
    install(monkeypatch, generated)
    response = client.post('/api/analyze', json={'text': demo['source_text']})
    assert response.status_code == 200, response.text
    assert response.json()[collection][0]['quote'] == original
    assert any('регистр' in w for w in response.json()['warnings'])


def test_ambiguous_case_matches_are_rejected(client, demo, monkeypatch):
    generated = generated_content(demo)
    original = generated['steps'][0]['quote']
    generated['steps'][0]['quote'] = original.swapcase()
    source = demo['source_text'] + '\n' + original.upper()
    assert source.lower().count(original.lower()) == 2
    install(monkeypatch, generated)
    response = client.post('/api/analyze', json={'text': source})
    assert response.status_code == 502


def test_case_repair_does_not_accept_changed_words_or_added_punctuation(client, demo, monkeypatch):
    generated = generated_content(demo)
    generated['steps'][0]['quote'] = 'Я завожу заявку в CRM.'
    assert generated['steps'][0]['quote'] not in demo['source_text']
    install(monkeypatch, generated)
    response = client.post('/api/analyze', json={'text': demo['source_text']})
    assert response.status_code == 502


def test_overlapping_case_matches_are_ambiguous_too(client, demo, monkeypatch):
    generated = generated_content(demo)
    generated['steps'][0]['quote'] = 'АбА'
    source = demo['source_text'] + '\nабаба'
    assert 'АбА' not in source
    install(monkeypatch, generated)
    response = client.post('/api/analyze', json={'text': source})
    assert response.status_code == 502
