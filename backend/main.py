from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

from . import llm
from .demos import DEMO_ANALYSES, EXAMPLES
from .imports import ImportBodyLimit, import_text
from .models import Analysis, AnalyzeRequest, EDIT_WARNING, Example
from .report import render_report
from .pdf_report import render_pdf_report

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
load_dotenv(ROOT / ".env")

app = FastAPI(title="Процесс под микроскопом")
app.add_middleware(ImportBodyLimit)
frontend = StaticFiles(directory=DIST, html=True, check_dir=False)


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, error: RequestValidationError):
    # Keep the field paths without echoing submitted transcripts in error bodies.
    details = [{key: item[key] for key in ("type", "loc", "msg")} for item in error.errors()]
    return JSONResponse(status_code=422, content={"detail": details})


@app.get("/api/health")
async def health():
    config = llm.settings()
    return {
        "status": "ok", "llm_configured": config.configured,
        "model": config.model if config.configured else None,
    }


@app.get("/api/examples", response_model=list[Example])
async def examples():
    return list(EXAMPLES.values())


@app.post("/api/analyze", response_model=Analysis)
async def analyze(request: AnalyzeRequest):
    if request.demo_id is not None:
        example = EXAMPLES.get(request.demo_id)
        if example is None or request.text != example.text:
            raise HTTPException(422, "Для деморежима выберите сохранённый пример без изменений текста.")
        return DEMO_ANALYSES[request.demo_id]

    config = llm.settings()
    if not config.configured:
        raise HTTPException(
            503, "Для анализа своего текста настройте LLM_API_KEY, LLM_BASE_URL и LLM_MODEL "
            "на сервере или выберите демопример."
        )
    try:
        return await llm.complete(request.text, config)
    except llm.ProviderError as error:
        raise HTTPException(error.status_code, str(error)) from None


@app.post("/api/import")
async def import_document(file: UploadFile):
    return await import_text(file)


def check_demo_source(analysis: Analysis) -> None:
    if analysis.mode == "demo":
        example = EXAMPLES.get(analysis.demo_id)
        if example is None or example.text != analysis.source_text:
            raise HTTPException(422, "Текст деморазбора должен совпадать с сохранённым примером.")


@app.post("/api/validate", response_model=Analysis)
async def validate(analysis: Analysis):
    check_demo_source(analysis)
    warnings = [EDIT_WARNING, *[warning for warning in analysis.warnings if warning != EDIT_WARNING][:23]]
    return analysis.model_copy(update={"edited": True, "warnings": warnings})


@app.post("/api/report")
async def report(analysis: Analysis):
    check_demo_source(analysis)
    return {"markdown": render_report(analysis)}


@app.post("/api/report/pdf", response_class=Response)
def report_pdf(analysis: Analysis):
    check_demo_source(analysis)
    return Response(
        content=render_pdf_report(analysis), media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="phoenix-report.pdf"'},
    )


@app.api_route(
    "/api/{_path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    include_in_schema=False,
)
@app.api_route(
    "/api", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    include_in_schema=False,
)
async def unknown_api():
    raise HTTPException(404, "Маршрут API не найден.")


@app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_frontend(path: str, request: Request):
    if not (DIST / "index.html").is_file():
        raise HTTPException(404, "Собранный интерфейс не найден.")
    try:
        return await frontend.get_response(frontend.get_path(request.scope), request.scope)
    except StarletteHTTPException as error:
        if error.status_code != 404 or Path(path).suffix:
            raise
        return await frontend.get_response("index.html", request.scope)
