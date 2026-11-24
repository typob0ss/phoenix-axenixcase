"""The defense upload must remain usable with the grounded offline backup."""

import asyncio
from pathlib import Path

import httpx

from backend.models import Analysis


def test_defense_upload_has_grounded_measured_backup_and_live_route(monkeypatch):
    # Missing/truncated downloads, stale source, ungrounded findings, and removal
    # of measured losses must break this end-to-end defense contract.
    sample = Path(__file__).resolve().parents[1] / "public/examples/axenix-defense.txt"
    assert sample.is_file(), "Provide the defense TXT for live upload and offline rehearsal"
    source = sample.read_text(encoding="utf-8")
    assert 1000 <= len(source) <= 5000
    assert "Учебный пример. Замеры и суммы вымышлены." in source

    from backend.main import app

    monkeypatch.setenv("LLM_API_KEY", "")

    async def rehearse():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            uploaded = await client.post("/api/import", files={
                "file": (sample.name, source.encode("utf-8"), "text/plain"),
            })
            assert uploaded.status_code == 200, uploaded.text
            assert uploaded.json()["text"] == source

            examples = (await client.get("/api/examples")).json()
            retail = next(example for example in examples if example["id"] == "retail")
            assert source == retail["text"], "Download and stored evidence have drifted"
            backup = await client.post("/api/analyze", json={"text": source, "demo_id": "retail"})
            assert backup.status_code == 200, backup.text

            # The same uploaded text without demo_id must use the live route;
            # an unconfigured provider must never silently return a demo.
            live = await client.post("/api/analyze", json={"text": uploaded.json()["text"]})
            assert live.status_code == 503, live.text
            return backup.json()

    analysis = Analysis.model_validate(asyncio.run(rehearse()))
    assert analysis.mode == "demo" and analysis.demo_id == "retail"
    assert analysis.source_text == source
    assert len(analysis.bottlenecks) >= 3
    assert len(analysis.recommendations) >= 3
    assert {6, 40, 9} <= {loss.time_minutes for loss in analysis.bottlenecks}
    assert any(loss.cost_rub == 90 for loss in analysis.bottlenecks)
    for loss in analysis.bottlenecks:
        assert loss.quote in source and loss.cause and loss.loss_type and loss.metric_basis
    for recommendation in analysis.recommendations:
        assert recommendation.quote in source
        assert recommendation.bottleneck_ids and recommendation.effect and recommendation.calculation
        assert recommendation.complexity in {"low", "medium", "high"}
        assert recommendation.risk in {"low", "medium", "high"}
    assert any(rec.estimated_saving_minutes == 4 for rec in analysis.recommendations)
    assert any("Замеры и суммы вымышлены" in warning for warning in analysis.warnings)
