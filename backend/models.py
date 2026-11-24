import re
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator


def require_text(value: str) -> str:
    if not value.strip() or "\x00" in value:
        raise ValueError("Поле должно содержать текст без нулевых символов.")
    return value


def require_source(value: str) -> str:
    require_text(value)
    if len(value.strip()) < 1000:
        raise ValueError("Стенограмма должна содержать от 1000 до 5000 символов.")
    return value


SourceText = Annotated[str, Field(min_length=1000, max_length=5000), AfterValidator(require_source)]
Identifier = Annotated[str, Field(min_length=1, max_length=80), AfterValidator(require_text)]
Label = Annotated[str, Field(max_length=200), AfterValidator(require_text)]
Explanation = Annotated[str, Field(max_length=600), AfterValidator(require_text)]
Quote = Annotated[str, Field(max_length=5000), AfterValidator(require_text)]
Metric = Annotated[float, Field(ge=0, allow_inf_nan=False)] | None
Level = Literal["low", "medium", "high"]
StepType = Literal["task", "decision", "wait", "handoff", "rework", "manual_input"]


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", hide_input_in_errors=True)


class AnalyzeRequest(StrictModel):
    text: SourceText
    demo_id: Identifier | None = None


class Example(StrictModel):
    id: Identifier
    title: Label
    sector: Label
    description: Explanation
    text: SourceText


class Role(StrictModel):
    id: Identifier
    name: Label


class Step(StrictModel):
    id: Identifier
    title: Label
    role_id: Identifier
    type: StepType
    quote: Quote
    confidence: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    systems: Annotated[list[Label], Field(max_length=12)]
    documents: Annotated[list[Label], Field(max_length=12)]
    duration_minutes: Metric


class Edge(StrictModel):
    id: Identifier
    from_step: Identifier
    to_step: Identifier
    label: Label
    quote: Quote


class Bottleneck(StrictModel):
    id: Identifier
    title: Label
    step_ids: Annotated[list[Identifier], Field(min_length=1, max_length=30)]
    loss_type: Label
    cause: Explanation
    quote: Quote
    time_minutes: Metric
    cost_rub: Metric
    metric_basis: Explanation


class Recommendation(StrictModel):
    id: Identifier
    title: Label
    description: Explanation
    bottleneck_ids: Annotated[list[Identifier], Field(min_length=1, max_length=30)]
    quote: Quote
    effect: Explanation
    estimated_saving_minutes: Metric
    calculation: Explanation
    complexity: Level
    risk: Level
    priority: Annotated[int, Field(ge=1)]


class AnalysisContent(StrictModel):
    title: Label
    roles: Annotated[list[Role], Field(min_length=1, max_length=24)]
    steps: Annotated[list[Step], Field(min_length=1, max_length=60)]
    edges: Annotated[list[Edge], Field(max_length=150)]
    bottlenecks: Annotated[list[Bottleneck], Field(max_length=30)]
    recommendations: Annotated[list[Recommendation], Field(max_length=30)]
    warnings: Annotated[list[Explanation], Field(max_length=24)]


INSUFFICIENT_FINDINGS = "Текст подтверждает ограниченное число потерь и предложений. Уточните детали процесса."
EDIT_WARNING = "Схема отредактирована. Перепроверьте связанные узкие места, рекомендации и расчёты."

NUMBER = r"\d+(?:[ \u00a0\u202f]\d{3})*(?:[,.]\d+)?"
NUMBER_BOUNDARY = r"(?<![\w,.−–—+\-])"
TIME_UNIT = (
    r"(?:минут(?:а|ы|у|е|ой|ам|ами|ах)?|мин\.?|час(?:а|ов|у|е|ом|ам|ами|ах)?"
    r"|ч\.?|сут(?:ок|ки)|дн(?:ей|я)|день)(?!\w)"
)
COST_UNIT = r"(?:₽|рубл(?:ь|я|ей|ём|ем|ями|ях)|руб\.?)(?!\w)"
DURATION_SPACE = r"[ \t\u00a0\u202f]+"
DURATION_PART = re.compile(rf"(?P<amount>{NUMBER})\s*(?P<unit>{TIME_UNIT})", re.IGNORECASE)
DURATION = re.compile(
    rf"{NUMBER_BOUNDARY}{DURATION_PART.pattern}"
    rf"(?:(?:{DURATION_SPACE}и)?{DURATION_SPACE}{NUMBER}\s*{TIME_UNIT}){{0,2}}",
    re.IGNORECASE,
)
COST = re.compile(
    rf"{NUMBER_BOUNDARY}(?P<amount>{NUMBER})\s*{COST_UNIT}",
    re.IGNORECASE,
)
TIME_FACTORS = {"час": 60, "ч": 60, "сут": 1440, "дн": 1440, "де": 1440, "мин": 1}
INEXACT_AMOUNT = re.compile(
    r"\b(?:до|от|или|около|примерно|порядка|почти|свыше|минимум|максимум"
    r"|не менее|не более|не ниже|не выше|не превышает|меньше|больше)$"
    rf"|[−+\-]$|\d\s*(?:{TIME_UNIT}|{COST_UNIT})?\s*[–—]$",
    re.IGNORECASE,
)
RANGE_END = re.compile(
    r"\s*(?:(?:[-–—−]|\bдо\b|\bили\b)\s*\d|"
    r"(?:максимум|минимум|приблизительно|примерно|и более|и менее|или больше|или меньше)\b)",
    re.IGNORECASE,
)
COST_RATE = re.compile(
    r"\s*(?:/\s*\w|(?:за|в|на)\s+(?:один\s+|одну\s+)?"
    r"(?:час\w*|ч\.|минут\w*|день|сут\w*|недел\w*|месяц\w*|смен\w*)\b)",
    re.IGNORECASE,
)
RATE_CONTEXT = re.compile(r"\b(?:тариф\w*|ставк\w*|расценк\w*)\b", re.IGNORECASE)
MISSING_BASIS = re.compile(
    r"^(?:нет данных|данных нет|неизвестно|не указано|не измерялось|не измерено"
    r"|нет сведений|не установлено)(?:[.!…\s]|$)",
    re.IGNORECASE,
)
SAVINGS = re.compile(r"\b(?:эконом\w*|сэконом\w*|сократ\w*|сокращ\w*|снизи\w*)", re.IGNORECASE)
MEASUREMENT = re.compile(
    r"\b(?:пилот\w*|замер\w*|измер\w*|фактическ\w*|наблюдени\w*|сэкономили|сократилось|снизилось)",
    re.IGNORECASE,
)
FORECAST = re.compile(
    r"\b(?:ожида\w*|планир\w*|предполага\w*|прогноз\w*|может|могут"
    r"|позволит|позволят|сэкономит|сэкономят|потенциально|будет)\b",
    re.IGNORECASE,
)
CLAUSE_END = re.compile(r"[.!?;\n]")


def exact_number(raw: str) -> Decimal:
    return Decimal("".join(raw.split()).replace(",", "."))


def duration_minutes(raw: str) -> Decimal | None:
    total = Decimal(0)
    previous_factor = 1441
    for part in DURATION_PART.finditer(raw):
        unit = part["unit"].lower()
        factor = next(value for key, value in TIME_FACTORS.items() if unit.startswith(key))
        if factor >= previous_factor:
            return None
        total += exact_number(part["amount"]) * factor
        previous_factor = factor
    return total


def ground_quantity(source: str, pattern: re.Pattern[str]) -> list[tuple[int, int, float]]:
    amounts = []
    for match in pattern.finditer(source):
        start, end = match.span()
        prefix = source[:start]
        suffix = source[end:]
        before = CLAUSE_END.split(prefix)[-1]
        after = CLAUSE_END.split(suffix, maxsplit=1)[0]
        if (
            INEXACT_AMOUNT.search(" ".join(prefix.split()))
            or RANGE_END.match(suffix)
            or FORECAST.search(f"{before} {after}")
        ):
            continue
        if pattern is DURATION:
            amount = duration_minutes(match[0])
        else:
            # A charge per hour cannot be used as the total cost of the loss.
            if COST_RATE.match(suffix) or RATE_CONTEXT.search(before):
                continue
            amount = exact_number(match["amount"])
        if amount is not None:
            end -= source[end - 1] == "."
            amounts.append((start, end, float(amount)))
    return amounts


def check_metric(
    number: Metric, quote: str, source: str, quantities: list[tuple[int, int, float]], field: str
) -> None:
    if number is None:
        return
    for start, end, amount in quantities:
        # The matched quantity must fit entirely inside an occurrence of the exact quote.
        if number == amount and source.find(quote, max(0, end - len(quote)), start + len(quote)) >= 0:
            return
    raise ValueError(f"{field}: цитата должна содержать точное значение с единицей измерения.")


def check_basis(basis: str, field: str) -> None:
    if MISSING_BASIS.match(basis.strip()) or len(re.findall(r"[^\W\d_]+", basis)) < 2:
        raise ValueError(f"{field}: укажите источник измерения или способ расчёта.")


def distinct_ids(items: list, group: str) -> set[str]:
    identifiers = {item.id for item in items}
    if len(identifiers) != len(items):
        raise ValueError(f"{group}: идентификаторы должны быть уникальными.")
    return identifiers


def check_references(references: list[str], known: set[str], field: str) -> None:
    if len(set(references)) != len(references):
        raise ValueError(f"{field}: ссылка указана несколько раз.")
    if not set(references) <= known:
        raise ValueError(f"{field}: ссылка указывает на отсутствующий элемент.")


class Analysis(AnalysisContent):
    schema_version: Literal["1.0"]
    source_text: SourceText
    mode: Literal["demo", "live"]
    demo_id: Identifier | None
    edited: bool

    @model_validator(mode="after")
    def check_evidence_and_references(self) -> Self:
        if (self.mode == "demo") != (self.demo_id is not None):
            raise ValueError("Режим анализа и идентификатор примера не совпадают.")

        roles = distinct_ids(self.roles, "roles")
        steps = distinct_ids(self.steps, "steps")
        distinct_ids(self.edges, "edges")
        bottlenecks = distinct_ids(self.bottlenecks, "bottlenecks")
        distinct_ids(self.recommendations, "recommendations")

        durations = ground_quantity(self.source_text, DURATION)
        costs = ground_quantity(self.source_text, COST)

        for collection in (self.steps, self.edges, self.bottlenecks, self.recommendations):
            for item in collection:
                if item.quote not in self.source_text:
                    raise ValueError(f"{item.id}: цитата должна точно совпадать с фрагментом стенограммы.")

        for step in self.steps:
            check_references([step.role_id], roles, f"{step.id}.role_id")
            check_metric(step.duration_minutes, step.quote, self.source_text, durations, f"{step.id}.duration_minutes")

        for edge in self.edges:
            check_references([edge.from_step], steps, f"{edge.id}.from_step")
            check_references([edge.to_step], steps, f"{edge.id}.to_step")

        for bottleneck in self.bottlenecks:
            check_references(bottleneck.step_ids, steps, f"{bottleneck.id}.step_ids")
            check_metric(bottleneck.time_minutes, bottleneck.quote, self.source_text, durations, f"{bottleneck.id}.time_minutes")
            check_metric(bottleneck.cost_rub, bottleneck.quote, self.source_text, costs, f"{bottleneck.id}.cost_rub")
            if bottleneck.cost_rub is not None:
                check_basis(bottleneck.metric_basis, f"{bottleneck.id}.metric_basis")

        for recommendation in self.recommendations:
            check_references(
                recommendation.bottleneck_ids, bottlenecks, f"{recommendation.id}.bottleneck_ids"
            )
            if recommendation.estimated_saving_minutes is not None:
                check_metric(
                    recommendation.estimated_saving_minutes, recommendation.quote, self.source_text,
                    durations, f"{recommendation.id}.estimated_saving_minutes",
                )
                if (
                    not SAVINGS.search(recommendation.quote)
                    or not MEASUREMENT.search(recommendation.quote)
                    or FORECAST.search(recommendation.quote)
                ):
                    raise ValueError("Для численной экономии приведите цитату с результатом измерения.")
                check_basis(recommendation.calculation, f"{recommendation.id}.calculation")

        return self
