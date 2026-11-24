import html
import re

from .models import Analysis, EDIT_WARNING


STEP_TYPES = {
    "task": "действие",
    "decision": "решение",
    "wait": "ожидание",
    "handoff": "передача",
    "rework": "доработка",
    "manual_input": "ручной ввод",
}


def markdown_text(value: str, limit: int) -> str:
    words = list(re.finditer(r"\S+", value))
    if len(words) > limit:
        value = value[:words[limit - 1].end()] + "…"
    value = " ".join(value.splitlines())
    return re.sub(r"([\\`*_{\[\]#|])", r"\\\1", html.escape(value, quote=False))


def format_metric(value: float | None, unit: str, missing: str = "нет подтверждённого замера в интервью") -> str:
    return missing if value is None else f"{value:g} {unit}"


def render_report(analysis: Analysis) -> str:
    title = markdown_text(analysis.title, 14)
    mode = "Сохранённый деморазбор" if analysis.mode == "demo" else "Анализ внешней моделью"
    lines = [f"# {title}", "", mode, "",
             f"Роли — {len(analysis.roles)} · Шаги — {len(analysis.steps)} · Переходы — {len(analysis.edges)}"]

    if analysis.edited:
        lines.extend(["", EDIT_WARNING])
    role_names = {role.id: markdown_text(role.name, 5) for role in analysis.roles}
    step_names = {step.id: markdown_text(step.title, 7) for step in analysis.steps}

    lines.extend(["", "## Шаги процесса", ""])
    for step in analysis.steps[:10]:
        lines.append(f"- {step_names[step.id]} · {role_names[step.role_id]} · {STEP_TYPES[step.type]}")
    if len(analysis.steps) > 10:
        lines.append("- Остальные шаги доступны в полной схеме и JSON.")

    if analysis.edges:
        lines.extend(["", "## Переходы", ""])
        for edge in analysis.edges[:10]:
            label = markdown_text(edge.label, 5)
            lines.append(f"- {step_names[edge.from_step]} → {step_names[edge.to_step]} · {label}")
        if len(analysis.edges) > 10:
            lines.append("- Полный список переходов доступен в схеме и JSON.")

    lines.extend(["", "## Узкие места", ""])
    if not analysis.bottlenecks:
        lines.append("В стенограмме недостаточно сведений о потерях.")
    for loss in analysis.bottlenecks[:3]:
        lines.extend([
            f"- **{markdown_text(loss.title, 8)}**. {markdown_text(loss.cause, 14)}",
            "",
            f"  > {markdown_text(loss.quote, 22)}",
            "",
            f"  Потери времени — {format_metric(loss.time_minutes, 'мин', 'по интервью нельзя точно рассчитать')}.  ",
            f"  Стоимость потерь — {format_metric(loss.cost_rub, '₽', 'для расчёта не хватает исходных данных')}.  ",
            f"  {markdown_text(loss.metric_basis, 12)}",
        ])
        if loss.time_minutes is None or loss.cost_rub is None:
            lines.append("  **Что уточнить для расчёта:**")
            if loss.time_minutes is None:
                lines.append("  Сколько минут теряется и сколько раз возникает проблема?")
            if loss.cost_rub is None:
                lines.append("  Какова стоимость часа участников и прямые расходы?")

    lines.extend(["", "## Предложения по автоматизации", ""])
    if not analysis.recommendations:
        lines.append("Предложения пока не сформулированы.")
    for item in sorted(analysis.recommendations, key=lambda recommendation: recommendation.priority)[:3]:
        lines.extend([
            f"- **{markdown_text(item.title, 8)}**. {markdown_text(item.description, 12)}",
            "",
            f"  > {markdown_text(item.quote, 22)}",
            "",
        ])
        if item.estimated_saving_minutes is not None:
            lines.append(f"  Измеренная экономия — {format_metric(item.estimated_saving_minutes, 'мин')}.  ")
        else:
            lines.append("  Экономия времени требует замера в пилоте: сравните время до и после.  ")
        lines.extend([
            f"  Ожидаемый эффект — {markdown_text(item.effect, 10)}  ",
            f"  Как проверить — {markdown_text(item.calculation, 12)}",
        ])

    lines.extend(["", "## Ограничения", "",
                  "Ожидаемые эффекты проверяются в пилоте. Длительность операции и приблизительные оценки из интервью сами по себе не показывают размер потерь."])
    warnings = [warning for warning in analysis.warnings if warning != EDIT_WARNING]
    lines.extend(f"- {markdown_text(warning, 16)}" for warning in warnings[:2])
    return "\n".join(lines) + "\n"
