"""A bounded A4 summary; JSON preserves the complete evidence."""
import io
from functools import lru_cache
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from .models import Analysis
from .report import format_metric

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 38
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN
FONT_PATH = Path(__file__).resolve().parent.parent / 'public' / 'fonts' / 'golos-variable.ttf'
LEVELS = {'low': 'низкая', 'medium': 'средняя', 'high': 'высокая'}
RISKS = {'low': 'низкий', 'medium': 'средний', 'high': 'высокий'}


@lru_cache(maxsize=1)
def report_font() -> str:
    name = 'PhoenixGolos'
    pdfmetrics.registerFont(TTFont(name, str(FONT_PATH)))
    return name


def bounded_lines(text: str, font: str, size: float, width: float, limit: int) -> list[str]:
    """Wrap measured glyphs, including unbroken IDs; ellipsis means an excerpt."""
    remaining = ' '.join(text.split())
    lines = []
    while remaining and len(lines) < limit:
        if pdfmetrics.stringWidth(remaining, font, size) <= width:
            lines.append(remaining)
            break
        last = len(lines) == limit - 1
        suffix = '…' if last else ''
        end = 0
        for index in range(1, len(remaining) + 1):
            if pdfmetrics.stringWidth(remaining[:index] + suffix, font, size) > width:
                break
            end = index
        end = max(1, end)
        space = remaining.rfind(' ', 0, end + 1)
        if space > 0:
            end = space
        lines.append(remaining[:end].rstrip() + suffix)
        remaining = remaining[end:].lstrip()
    return lines


def render_pdf_report(analysis: Analysis) -> bytes:
    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4, pageCompression=1)
    font = report_font()
    pdf.setTitle(analysis.title)
    pdf.setAuthor('Феникс')

    def paragraph(text: str, y: float, size=9, limit=1, leading=12, muted=False) -> float:
        pdf.setFont(font, size)
        pdf.setFillColor(colors.HexColor('#55545a' if muted else '#202024'))
        for line in bounded_lines(text, font, size, CONTENT_WIDTH, limit):
            pdf.drawString(MARGIN, y, line)
            y -= leading
        return y

    def rule(y):
        pdf.setStrokeColor(colors.HexColor('#dedcdf'))
        pdf.setLineWidth(.5)
        pdf.line(MARGIN, y, PAGE_WIDTH - MARGIN, y)

    paragraph('ФЕНИКС  /  КРАТКИЙ ОТЧЁТ О ПРОЦЕССЕ', PAGE_HEIGHT - 38, size=9, muted=True)
    rule(PAGE_HEIGHT - 50)
    y = paragraph(analysis.title, PAGE_HEIGHT - 72, size=16, limit=2, leading=20)
    y = paragraph(f'Роли: {len(analysis.roles)}  ·  Шаги: {len(analysis.steps)}  ·  Переходы: {len(analysis.edges)}', y - 5)
    if analysis.mode == 'demo':
        mode = 'Учебные вымышленные данные · сохранённый деморазбор'
    elif 'Учебный пример. Замеры и суммы вымышлены.' in analysis.source_text:
        mode = 'Учебные вымышленные данные · анализ внешней моделью'
    else:
        mode = 'Анализ внешней моделью · выводы проверяет человек'
    y = paragraph(mode, y - 2, muted=True) - 13

    y = paragraph(f'Узкие места — показано {min(3, len(analysis.bottlenecks))} из {len(analysis.bottlenecks)}', y, size=12, leading=18) - 3
    start = y
    if not analysis.bottlenecks:
        paragraph('Недостаточно подтверждённых сведений о потерях. Дополните исходный текст.', y, limit=2)
    for index, loss in enumerate(analysis.bottlenecks[:3]):
        top = start - index * 84
        cursor = paragraph(f'{index + 1}. {loss.title}', top, size=10.5, limit=2, leading=13)
        cursor = paragraph(f'Причина: {loss.cause}', cursor - 1, limit=1)
        cursor = paragraph(f'Потери времени: {format_metric(loss.time_minutes, "мин", "нужен точный замер")}  ·  Стоимость: {format_metric(loss.cost_rub, "₽", "нужны исходные данные")}', cursor, muted=True)
        paragraph(f'Цитата: {loss.quote}', cursor, size=8.5, limit=2, leading=11, muted=True)
        rule(top - 76)
    y = start - 3 * 84 - 4

    y = paragraph(f'Приоритеты автоматизации — показано {min(3, len(analysis.recommendations))} из {len(analysis.recommendations)}', y, size=12, leading=18) - 3
    start = y
    if not analysis.recommendations:
        paragraph('Недостаточно оснований для предложений. Гипотезы не добавлены ради количества.', y, limit=2)
    for index, item in enumerate(sorted(analysis.recommendations, key=lambda item: item.priority)[:3]):
        top = start - index * 84
        cursor = paragraph(f'{index + 1}. {item.title}', top, size=10.5, limit=2, leading=13)
        cursor = paragraph(f'Эффект: {item.effect}', cursor - 1, limit=1)
        cursor = paragraph(f'Приоритет: {item.priority}  ·  Сложность: {LEVELS[item.complexity]}  ·  Риск: {RISKS[item.risk]}', cursor, muted=True)
        cursor = paragraph(f'Экономия: {format_metric(item.estimated_saving_minutes, "мин", "требует замера в пилоте")}', cursor, muted=True)
        paragraph(f'Цитата: {item.quote}', cursor, size=8.5, limit=1, leading=11, muted=True)
        rule(top - 76)

    if analysis.edited:
        paragraph('Перепроверьте выводы и расчёты после ручных изменений.', 90, limit=2, muted=True)
    elif analysis.warnings:
        paragraph('Ограничение: ' + analysis.warnings[0], 90, limit=2, muted=True)
    paragraph('Уточнить: время потерь, частоту и стоимость часа. Эффекты проверить в пилоте.', 58, size=8.5, muted=True)
    paragraph('Цитаты сокращены. Подробный отчёт — в Markdown, полные данные — в JSON.', 45, size=8.5, muted=True)
    pdf.showPage()
    pdf.save()
    return output.getvalue()
