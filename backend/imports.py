from io import BytesIO
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile

from docx import Document
from docx.opc.exceptions import PackageNotFoundError
from docx.table import Table
from docx.text.paragraph import Paragraph
from fastapi import HTTPException, UploadFile
from fastapi.responses import JSONResponse
from lxml.etree import XMLSyntaxError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 64 * 1024
MAX_DOCX_BYTES = 16 * 1024 * 1024
MAX_DOCX_ENTRIES = 512
UPLOAD_LIMIT_MESSAGE = "Файл превышает 2 МБ или форма загрузки слишком велика."


class ImportBodyLimit:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] != "/api/import" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return

        try:
            declared_size = int(Headers(scope=scope).get("content-length", "0"))
        except ValueError:
            declared_size = 0
        too_large = JSONResponse({"detail": UPLOAD_LIMIT_MESSAGE}, status_code=413)
        if declared_size > MAX_MULTIPART_BYTES:
            await too_large(scope, receive, send)
            return

        # Accept a bounded body before invoking the multipart parser or opening its temporary files.
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > MAX_MULTIPART_BYTES:
                await too_large(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        buffered: Message | None = {"type": "http.request", "body": bytes(body), "more_body": False}
        del body

        async def replay() -> Message:
            nonlocal buffered
            if buffered is not None:
                message, buffered = buffered, None
                return message
            return await receive()

        await self.app(scope, replay, send)


def docx_text(data: bytes) -> str:
    try:
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_DOCX_ENTRIES or sum(entry.file_size for entry in entries) > MAX_DOCX_BYTES:
                raise HTTPException(413, "Распакованный DOCX превышает допустимый размер.")
            filenames = set(archive.namelist())
            if len(filenames) != len(entries) or any(entry.flag_bits & 1 for entry in entries):
                raise ValueError("Duplicate or encrypted ZIP entries")
            if "[Content_Types].xml" not in filenames or "word/document.xml" not in filenames:
                raise ValueError("Missing DOCX parts")

        document = Document(BytesIO(data))
        blocks = []
        for block in document.iter_inner_content():
            if isinstance(block, Paragraph):
                blocks.append(block.text)
            elif isinstance(block, Table):
                blocks.extend("\t".join(cell.text for cell in row.cells) for row in block.rows)
        return "\n".join(blocks)
    except (BadZipFile, PackageNotFoundError, KeyError, ValueError, OSError, XMLSyntaxError,
            RuntimeError, NotImplementedError, AttributeError, TypeError):
        raise HTTPException(422, "Не удалось прочитать DOCX. Проверьте, что файл открывается в Word.") from None


async def import_text(upload: UploadFile) -> dict[str, str]:
    filename = PurePosixPath((upload.filename or "").replace("\\", "/")).name
    suffix = PurePosixPath(filename).suffix.lower()
    if suffix not in {".txt", ".docx"}:
        raise HTTPException(415, "Загрузите TXT в UTF-8 или документ DOCX.")
    if upload.size is not None and upload.size > MAX_FILE_BYTES:
        raise HTTPException(413, "Файл превышает 2 МБ.")
    raw = await upload.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(413, "Файл превышает 2 МБ.")

    if suffix == ".txt":
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(422, "Сохраните TXT в кодировке UTF-8 и загрузите снова.") from None
    else:
        text = await run_in_threadpool(docx_text, raw)
    if not text.strip() or "\x00" in text:
        raise HTTPException(422, "В файле нет читаемого текста.")
    return {"text": text, "filename": filename}
