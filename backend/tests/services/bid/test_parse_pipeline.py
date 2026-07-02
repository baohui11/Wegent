# SPDX-License-Identifier: Apache-2.0
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid import parse_pipeline as pp
from app.services.bid.workspace import BidWorkspace


def _seed(ws):
    ws.write_json("workspace/tender_manifest.json", {"segments": []})
    (ws.dir() / "workspace" / "tender_segments").mkdir(parents=True, exist_ok=True)
    ws.write_json("workspace/veto_candidates.json", {"candidates": []})


@pytest.mark.asyncio
async def test_parse_happy_path(tmp_path):
    ws = BidWorkspace("p1", root=tmp_path)
    ws.write_tender_text("正文")

    async def sleuth(**k):
        return {"project": {"a": 1}, "scoring": [{"id": "S1"}]}

    def merge(_ws):
        _ws.write_json("workspace/tender.json", {"scoring": [{"id": "S1"}]})
        return 0, "ok"

    with (
        patch.object(pp, "run_segment", side_effect=_seed),
        patch.object(pp, "call_tender_sleuth", new=AsyncMock(side_effect=sleuth)),
        patch.object(pp, "run_merge", side_effect=merge),
    ):
        tender = await pp.parse_tender(ws, model="m", model_config=None)
    assert tender["scoring"][0]["id"] == "S1"
    assert ws.path("workspace/tender_parts/project.json").exists()


@pytest.mark.asyncio
async def test_merge_failure_retries_once_then_raises(tmp_path):
    ws = BidWorkspace("p2", root=tmp_path)
    ws.write_tender_text("正文")
    calls = {"merge": 0}

    async def sleuth(**k):
        return {"project": {}}

    def merge(_ws):
        calls["merge"] += 1
        _ws.write_json(
            "workspace/tender.json", {"_meta": {"merge_issues": ["缺 scoring"]}}
        )
        return 1, "缺块"

    with (
        patch.object(pp, "run_segment", side_effect=_seed),
        patch.object(pp, "call_tender_sleuth", new=AsyncMock(side_effect=sleuth)),
        patch.object(pp, "run_merge", side_effect=merge),
    ):
        with pytest.raises(pp.BidPipelineError) as ei:
            await pp.parse_tender(ws, model="m", model_config=None)
    assert calls["merge"] == 2  # first run + one retry round
    assert "缺 scoring" in str(ei.value)  # issues surfaced to the human
