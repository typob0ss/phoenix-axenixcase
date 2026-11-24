import asyncio
import copy
import io
import json
from functools import partial
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import pytest
from docx import Document


class Client:
    def __init__(self, app):
        self.app = app

    def request(self, method, path, **kwargs):
        async def request():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=self.app), base_url="http://test"
            ) as client:
                return await client.request(method, path, **kwargs)

        return asyncio.run(request())

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)


@pytest.fixture
def client(monkeypatch):
    from backend.main import app

    monkeypatch.setenv("LLM_API_KEY", "")
    return Client(app)


@pytest.fixture
def demo(client):
    bank = client.get("/api/examples").json()[0]
    response = client.post("/api/analyze", json={"text": bank["text"], "demo_id": bank["id"]})
    assert response.status_code == 200
    return response.json()


def test_three_demos_are_grounded_and_have_process_branches(client):
    response = client.get("/api/examples")
    assert response.status_code == 200
    examples = response.json()
    assert [example["id"] for example in examples] == ["bank", "retail", "hr"]

    for example in examples:
        source = example["text"]
        assert 1000 <= len(source) <= 5000
        response = client.post("/api/analyze", json={"text": source, "demo_id": example["id"]})
        assert response.status_code == 200, response.text
        graph = response.json()
        assert graph["source_text"] == source
        assert graph["mode"] == "demo"
        assert graph["demo_id"] == example["id"]
        assert not graph["edited"]
        assert len(graph["roles"]) >= 3
        assert {"wait", "decision", "rework"} <= {step["type"] for step in graph["steps"]}
        assert len(graph["bottlenecks"]) >= 3
        assert len(graph["recommendations"]) >= 3
        assert sum(edge["from_step"] == next(
            step["id"] for step in graph["steps"] if step["type"] == "decision"
        ) for edge in graph["edges"]) >= 2
        for collection in ("steps", "edges", "bottlenecks", "recommendations"):
            assert all(entry["quote"] and entry["quote"] in source for entry in graph[collection])


@pytest.fixture
def retail_demo(client):
    example = next(item for item in client.get("/api/examples").json() if item["id"] == "retail")
    response = client.post("/api/analyze", json={"text": example["text"], "demo_id": "retail"})
    assert response.status_code == 200, response.text
    return response.json()


def test_retail_metrics_have_scoped_synthetic_evidence(retail_demo):
    losses = {loss["id"]: loss for loss in retail_demo["bottlenecks"]}
    duplicate = losses["retail-loss-1"]
    wait = losses["retail-loss-2"]
    reconciliation = losses["retail-loss-3"]

    assert (duplicate["time_minutes"], duplicate["cost_rub"]) == (6, 90)
    assert all(value in duplicate["quote"] for value in ("6 минут", "90 рублей"))
    assert "прямые расходы" in duplicate["metric_basis"].lower()
    assert wait["time_minutes"] == 40
    assert "одного контрольного возврата" in wait["quote"]
    assert "одно наблюдение" in wait["metric_basis"].lower()
    assert reconciliation["time_minutes"] == 9
    assert "одной операции" in reconciliation["metric_basis"]
    assert all(loss["quote"] in retail_demo["source_text"] for loss in losses.values())
    assert "замеры и суммы вымышлены" in retail_demo["source_text"].lower()
    assert any("замеры и суммы вымышлены" in warning.lower() for warning in retail_demo["warnings"])


def test_retail_pilot_saving_and_cost_survive_an_edit(client, retail_demo):
    recommendation = min(retail_demo["recommendations"], key=lambda item: item["priority"])
    assert recommendation["estimated_saving_minutes"] == 4
    assert recommendation["quote"] == (
        "На пилоте автоматическая передача карточки возврата экономит 4 минуты на возврат."
    )
    assert "журнал" in recommendation["calculation"]

    retail_demo["steps"][0]["title"] = "Оформить возврат в магазине"
    response = client.post("/api/validate", json=retail_demo)
    assert response.status_code == 200, response.text
    edited = response.json()
    assert edited["edited"]

    response = client.post("/api/report", json=edited)
    assert response.status_code == 200, response.text
    report = response.json()["markdown"]
    assert "Оформить возврат в магазине" in report
    assert "90 ₽" in report
    assert "Измеренная экономия — 4 мин" in report
    assert "замеры и суммы вымышлены" in report.lower()


def test_demo_id_requires_the_exact_original_text(client, demo):
    response = client.post("/api/analyze", json={
        "text": demo["source_text"] + " ",
        "demo_id": demo["demo_id"],
    })
    assert response.status_code == 422


def test_arbitrary_text_reports_missing_llm_configuration(client, demo):
    assert client.get("/api/health").json() == {
        "status": "ok", "llm_configured": False, "model": None
    }
    response = client.post("/api/analyze", json={"text": demo["source_text"]})
    assert response.status_code == 503
    assert "LLM_API_KEY" in response.json()["detail"]


def test_a_key_without_provider_or_model_leaves_demo_available(client, demo, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "not-enough")
    monkeypatch.setenv("LLM_BASE_URL", "")
    monkeypatch.setenv("LLM_MODEL", "")
    assert client.get("/api/health").json()["llm_configured"] is False
    assert client.post("/api/analyze", json={"text": demo["source_text"]}).status_code == 503
    assert client.post("/api/analyze", json={
        "text": demo["source_text"], "demo_id": demo["demo_id"]
    }).status_code == 200


@pytest.mark.parametrize("text", ["короткий текст", " " * 1500, "а" * 5001])
def test_input_length_enforced(client, text):
    assert client.post("/api/analyze", json={"text": text}).status_code == 422


@pytest.mark.parametrize(("collection", "field", "value"), [
    ("steps", "quote", "Цитата подменена."),
    ("steps", "quote", " "),
    ("steps", "role_id", "unknown"),
    ("steps", "confidence", 1.1),
    ("steps", "duration_minutes", 137),
    ("edges", "to_step", "unknown"),
    ("bottlenecks", "step_ids", ["unknown"]),
    ("bottlenecks", "cost_rub", -100),
    ("bottlenecks", "cost_rub", 100),
    ("recommendations", "bottleneck_ids", ["unknown"]),
    ("recommendations", "estimated_saving_minutes", 120),
    ("recommendations", "priority", "1"),
])
def test_invalid_analysis_is_rejected_for_edits_and_reports(client, demo, collection, field, value):
    demo[collection][0][field] = value
    for route in ("validate", "report"):
        response = client.post(f"/api/{route}", json=demo)
        assert response.status_code == 422, response.text


def test_duplicate_graph_ids_are_rejected(client, demo):
    demo["steps"].append(copy.deepcopy(demo["steps"][0]))
    assert client.post("/api/validate", json=demo).status_code == 422


@pytest.mark.parametrize(("quote", "minutes", "status"), [
    ("Согласование заняло 1,15 часа.", 69, 200),
    ("Согласование занимает от 10 до 15 минут.", 15, 422),
    ("На заводе работают 12 часовщиков.", 720, 422),
    ("В отчёте встречается отрицательная поправка − 12 минут.", 12, 422),
])
def test_duration_must_be_a_single_grounded_quantity(client, demo, quote, minutes, status):
    demo.update(mode="live", demo_id=None, source_text=f"{demo['source_text']}\n{quote}")
    demo["steps"][0].update(quote=quote, duration_minutes=minutes)
    assert client.post("/api/validate", json=demo).status_code == status


@pytest.mark.parametrize(("source", "citation", "minutes", "status"), [
    ("Ожидание занимает до 15 минут.", "15 минут", 15, 422),
    ("Сверка занимает не менее 15 минут.", "15 минут", 15, 422),
    ("Сверка занимает не менее 15 минут.", "15 минут", 15, 422),
    ("Сверка занимает 10 минут — 15 минут.", "15 минут", 15, 422),
    ("Сверка занимает 15 минут максимум.", "15 минут", 15, 422),
    ("Сверка занимает 115 минут.", "15 минут", 15, 422),
    ("Сверка занимает 1 ч 30 мин.", "1 ч 30 мин", 90, 200),
    ("Сверка занимает 1 час и 30 минут.", "30 минут", 30, 422),
])
def test_duration_uses_the_surrounding_source(client, demo, source, citation, minutes, status):
    demo.update(mode="live", demo_id=None, source_text=f"{demo['source_text']}\n{source}")
    demo["steps"][0].update(quote=citation, duration_minutes=minutes)
    assert client.post("/api/validate", json=demo).status_code == status


@pytest.mark.parametrize(("source", "basis", "status"), [
    ("Тариф курьера составляет 500 рублей за час.", "Сумма названа на встрече.", 422),
    ("Общие затраты составили 500 рублей.", "Нет данных.", 422),
    ("Общие затраты составили 500 рублей.", "Сумма из отчёта о расходах.", 200),
])
def test_grounded_cost_requires_an_absolute_amount_and_basis(client, demo, source, basis, status):
    demo.update(mode="live", demo_id=None, source_text=f"{demo['source_text']}\n{source}")
    demo["bottlenecks"][0].update(quote="500 рублей", cost_rub=500, metric_basis=basis)
    assert client.post("/api/validate", json=demo).status_code == status


def test_routine_bank_duration_is_not_used_for_repeat_work(demo):
    assert demo["steps"][1]["duration_minutes"] == 12
    repeat_work = next(loss for loss in demo["bottlenecks"] if "bank-rework" in loss["step_ids"])
    assert repeat_work["time_minutes"] is None


@pytest.mark.parametrize(("source", "basis", "status"), [
    ("На пилоте автоматическая сверка экономит 5 минут на заявку.", "Замер на пилоте по журналу заявок.", 200),
    ("На пилоте автоматическая сверка экономит 5 минут на заявку.", "Нет данных.", 422),
    ("Ожидается, что автоматическая сверка сэкономит 5 минут на заявку.", "Прогноз для пилота.", 422),
])
def test_savings_require_measured_evidence_and_calculation(client, demo, source, basis, status):
    demo.update(mode="live", demo_id=None, source_text=f"{demo['source_text']}\n{source}")
    demo["recommendations"][0].update(quote=source, estimated_saving_minutes=5, calculation=basis)
    response = client.post("/api/report", json=demo)
    assert response.status_code == status, response.text
    if status == 200:
        assert "5 мин" in response.json()["markdown"]


def test_savings_quote_cannot_omit_a_forecast_qualifier(client, demo):
    quote = "на пилоте автоматическая сверка экономит 5 минут на заявку"
    demo.update(mode="live", demo_id=None, source_text=f"{demo['source_text']}\nПредполагается, что {quote}.")
    demo["recommendations"][0].update(
        quote=quote, estimated_saving_minutes=5, calculation="Предварительная оценка по журналу.",
    )
    assert client.post("/api/validate", json=demo).status_code == 422


def test_report_uses_the_current_graph_and_edit_warning(client, demo):
    demo["steps"][0]["title"] = "Проверка заявки после исправления"
    demo["edges"][-1]["label"] = "После ручного согласования"
    response = client.post("/api/validate", json=demo)
    assert response.status_code == 200, response.text
    validated = response.json()
    assert validated["edited"]
    assert any("перепроверьте" in warning.lower() for warning in validated["warnings"])
    assert len(client.post("/api/validate", json=validated).json()["warnings"]) == len(validated["warnings"])

    response = client.post("/api/report", json=validated)
    assert response.status_code == 200, response.text
    report = response.json()["markdown"]
    assert "Проверка заявки после исправления" in report
    assert "После ручного согласования" in report
    assert demo["bottlenecks"][0]["quote"] in report
    assert demo["recommendations"][0]["title"] in report
    assert "перепроверьте" in report.lower()
    assert len(report.split()) < 700


def test_import_preserves_txt_and_removes_bom(client):
    response = client.post("/api/import", files={"file": (
        "стенограмма.TXT", "Первая строка\nВторая строка".encode("utf-8-sig")
    )})
    assert response.status_code == 200, response.text
    assert response.json() == {"text": "Первая строка\nВторая строка", "filename": "стенограмма.TXT"}


def test_import_reads_docx_paragraphs_and_table_cells_in_order(client):
    document = Document()
    document.add_paragraph("Начало совещания")
    table = document.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Роль"
    table.cell(0, 1).text = "Задача"
    document.add_paragraph("Конец совещания")
    data = io.BytesIO()
    document.save(data)

    response = client.post("/api/import", files={"file": ("meeting.docx", data.getvalue())})
    assert response.status_code == 200, response.text
    assert response.json()["text"] == "Начало совещания\nРоль\tЗадача\nКонец совещания"


@pytest.mark.parametrize(("filename", "data", "status"), [
    ("meeting.pdf", b"not text", 415),
    ("meeting.txt", b"\xff\xff", 422),
    ("meeting.docx", b"not a zip", 422),
    ("meeting.txt", b" " * 20, 422),
    ("meeting.txt", b"a" * (2 * 1024 * 1024 + 1), 413),
])
def test_import_rejects_unsupported_bad_empty_or_oversized_files(client, filename, data, status):
    assert client.post("/api/import", files={"file": (filename, data)}).status_code == status


def test_docx_uncompressed_size_is_bounded(client):
    data = io.BytesIO()
    with ZipFile(data, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", b" " * (16 * 1024 * 1024 + 1))

    response = client.post("/api/import", files={"file": ("meeting.docx", data.getvalue())})
    assert response.status_code == 413


def test_import_file_size_boundary_is_inclusive(client):
    exact_limit = 2 * 1024 * 1024
    response = client.post("/api/import", files={"file": ("meeting.txt", b"a" * exact_limit)})
    assert response.status_code == 200
    assert len(response.json()["text"]) == exact_limit


def test_multipart_body_limit_stops_streaming_before_the_end(client):
    async def upload():
        yield b'--bound\r\nContent-Disposition: form-data; name="file"; filename="big.txt"\r\n\r\n'
        yield b"x" * (2 * 1024 * 1024 + 128 * 1024)
        pytest.fail("The import consumed the stream after exceeding its multipart limit.")

    response = client.post(
        "/api/import", content=upload(), headers={"Content-Type": "multipart/form-data; boundary=bound"},
    )
    assert response.status_code == 413
    assert "2 МБ" in response.json()["detail"]


def set_provider(monkeypatch, handler):
    from backend import llm

    monkeypatch.setenv("LLM_API_KEY", "secret-test-token")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.invalid/v1/")
    monkeypatch.setenv("LLM_MODEL", "mock-model")
    monkeypatch.setattr(llm, "AsyncClient", partial(httpx.AsyncClient, transport=httpx.MockTransport(handler)))


def test_configured_provider_analyzes_arbitrary_source(client, demo, monkeypatch):
    source = demo["source_text"] + "\nЗамечание из рабочей стенограммы."
    generated = {key: demo[key] for key in (
        "title", "roles", "steps", "edges", "bottlenecks", "recommendations", "warnings"
    )}

    def handler(request):
        assert str(request.url) == "https://example.invalid/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer secret-test-token"
        body = json.loads(request.content)
        assert body["model"] == "mock-model"
        assert json.loads(body["messages"][-1]["content"])["source_text"] == source
        return httpx.Response(200, json={"choices": [{"message": {
            "content": json.dumps(generated, ensure_ascii=False)
        }}]})

    set_provider(monkeypatch, handler)
    health = client.get("/api/health")
    assert health.json() == {"status": "ok", "llm_configured": True, "model": "mock-model"}
    assert "secret-test-token" not in health.text
    response = client.post("/api/analyze", json={"text": source})
    assert response.status_code == 200, response.text
    analysis = response.json()
    assert analysis["mode"] == "live"
    assert analysis["demo_id"] is None
    assert analysis["source_text"] == source


@pytest.mark.parametrize(("provider_outcome", "status"), [
    ("timeout", 504), ("http_error", 502), ("bad_json", 502), ("forged_quote", 502),
    ("ungrounded_metric", 502),
])
def test_provider_failures_are_explained_without_substitution(client, demo, monkeypatch, provider_outcome, status):
    generated = {key: demo[key] for key in (
        "title", "roles", "steps", "edges", "bottlenecks", "recommendations", "warnings"
    )}

    def handler(request):
        if provider_outcome == "timeout":
            raise httpx.ReadTimeout("secret-test-token", request=request)
        if provider_outcome == "http_error":
            return httpx.Response(401, text="secret-test-token")
        if provider_outcome == "bad_json":
            return httpx.Response(200, json={"choices": []})
        if provider_outcome == "forged_quote":
            generated["steps"][0]["quote"] = "Придуманная цитата"
        if provider_outcome == "ungrounded_metric":
            generated["steps"][0]["duration_minutes"] = 137
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(generated)}}]})

    set_provider(monkeypatch, handler)
    response = client.post("/api/analyze", json={"text": demo["source_text"]})
    assert response.status_code == status, response.text
    assert isinstance(response.json()["detail"], str)
    assert "secret-test-token" not in response.text


def test_unknown_api_route_has_json_404(client):
    for path in ("/api", "/api/unknown"):
        response = client.get(path)
        assert response.status_code == 404
        assert "detail" in response.json()


def test_built_frontend_is_served_without_shadowing_api(client, monkeypatch, tmp_path):
    from backend import main
    from starlette.staticfiles import StaticFiles

    (tmp_path / "index.html").write_text("<h1>Axenix</h1>")
    (tmp_path / "app.js").write_text('console.log("app")')
    monkeypatch.setattr(main, "DIST", tmp_path)
    monkeypatch.setattr(main, "frontend", StaticFiles(directory=tmp_path, html=True))

    assert "<h1>Axenix</h1>" in client.get("/").text
    assert "<h1>Axenix</h1>" in client.get("/report").text
    assert 'console.log("app")' in client.get("/app.js").text
    assert client.get("/missing.js").status_code == 404
    assert client.post("/api/missing").status_code == 404
    assert "detail" in client.get("/api/missing").json()
