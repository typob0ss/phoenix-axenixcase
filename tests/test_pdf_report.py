import asyncio
import copy
import io

import httpx
import pytest
from pypdf import PdfReader

from backend.demos import DEMO_ANALYSES
from backend.main import app


def export_pdf(analysis):
    async def request():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            return await client.post('/api/report/pdf', json=analysis)
    return asyncio.run(request())


@pytest.mark.parametrize('example', ['bank', 'retail', 'hr'])
def test_pdf_is_one_a4_page_with_readable_cyrillic_and_three_priorities(example):
    analysis = DEMO_ANALYSES[example].model_dump()
    response = export_pdf(analysis)
    assert response.status_code == 200
    assert response.headers['content-type'] == 'application/pdf'
    assert 'attachment' in response.headers['content-disposition']
    reader = PdfReader(io.BytesIO(response.content))
    assert len(reader.pages) == 1
    page = reader.pages[0]
    assert float(page.mediabox.width) == pytest.approx(595.28, abs=1)
    assert float(page.mediabox.height) == pytest.approx(841.89, abs=1)
    text = page.extract_text()
    assert analysis['title'] in text
    assert 'Учебные' in text
    for item in analysis['bottlenecks'][:3]:
        assert item['title'] in text
    for item in sorted(analysis['recommendations'], key=lambda item: item['priority'])[:3]:
        assert item['title'] in text
    if example == 'retail':
        assert '90 ₽' in text
        assert '40 мин' in text
        assert '9 мин' in text


def test_pdf_uses_edited_result_and_keeps_the_recheck_warning():
    analysis = DEMO_ANALYSES['bank'].model_dump()
    analysis.update(title='Изменённый процесс согласования', edited=True)
    analysis['bottlenecks'][0]['title'] = 'Исправленная причина задержки'
    response = export_pdf(analysis)
    assert response.status_code == 200
    text = PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
    assert analysis['title'] in text
    assert analysis['bottlenecks'][0]['title'] in text
    assert 'Перепроверьте' in text


@pytest.mark.parametrize('sparse', [False, True])
def test_pdf_keeps_long_and_incomplete_results_on_one_page(sparse):
    analysis = copy.deepcopy(DEMO_ANALYSES['retail'].model_dump())
    analysis['title'] = 'Ж' * 200
    for item in analysis['bottlenecks']:
        item['title'] = 'Длинное название потери ' * 7
        item['cause'] = 'Длинное объяснение причины. ' * 20
        item['metric_basis'] = 'Основание из учебной стенограммы. ' * 15
    for item in analysis['recommendations']:
        item['title'] = 'Длинное название автоматизации ' * 6
        item['description'] = 'Описание гипотезы. ' * 25
        item['effect'] = 'Ожидаемый эффект. ' * 25
        item['calculation'] = 'Проверить в пилоте. ' * 25
    if sparse:
        analysis.update(bottlenecks=[], recommendations=[])
    response = export_pdf(analysis)
    assert response.status_code == 200, response.text[:300]
    reader = PdfReader(io.BytesIO(response.content))
    assert len(reader.pages) == 1
    if sparse:
        assert 'Недостаточно' in reader.pages[0].extract_text()
    positions = []
    reader.pages[0].extract_text(visitor_text=lambda text, cm, tm, font, size: positions.append(tm[5]) if text.strip() else None)
    assert positions and min(positions) >= 24
    assert max(positions) <= 818


def test_pdf_does_not_export_forged_quotes():
    analysis = DEMO_ANALYSES['bank'].model_dump()
    analysis['bottlenecks'][0]['quote'] = 'Придуманная цитата'
    assert export_pdf(analysis).status_code == 422


def test_uploaded_synthetic_sample_keeps_its_label_in_a_live_pdf():
    analysis = DEMO_ANALYSES['retail'].model_dump()
    analysis.update(mode='live', demo_id=None)
    response = export_pdf(analysis)
    assert response.status_code == 200
    text = PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
    assert 'Учебные вымышленные данные' in text
    assert 'внешней моделью' in text


def test_missing_metrics_explain_measurement_needs_in_pdf_and_markdown():
    from backend.report import render_report

    analysis = DEMO_ANALYSES['bank']
    markdown = render_report(analysis)
    response = export_pdf(analysis.model_dump())
    assert response.status_code == 200
    reader = PdfReader(io.BytesIO(response.content))
    assert len(reader.pages) == 1
    pdf_text = reader.pages[0].extract_text()
    for text in [markdown, pdf_text]:
        assert 'нет данных' not in text.lower()
        assert 'замера в пилоте' in text.lower()
        assert 'стоимость часа' in text.lower()
    assert 'Что уточнить для расчёта' in markdown
    assert 'сколько раз' in markdown


def test_zero_measurements_are_preserved_instead_of_missing_labels():
    from backend.report import format_metric

    assert format_metric(0, 'мин') == '0 мин'
    assert format_metric(0, '₽') == '0 ₽'
