# SPDX-License-Identifier: Apache-2.0
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid import parse_pipeline as pp
from app.services.bid.workspace import BidWorkspace


def _seed(ws):
    ws.write_json("workspace/tender_manifest.json", {"segments": []})
    (ws.dir() / "workspace" / "tender_segments").mkdir(parents=True, exist_ok=True)
    ws.write_json("workspace/veto_candidates.json", {"candidates": []})


def _complete_tender(**extra):
    t = {b: {} for b in pp._REQUIRED_BLOCKS}
    t.update(extra)
    return t


def test_write_parts_wraps_bare_value_under_block_key(tmp_path):
    # merge_tender.py does ``data.items()`` per part file, so each must be a
    # {block: value} dict. scoring is a LIST -> without wrapping merge crashes.
    ws = BidWorkspace("wp", root=tmp_path)
    pp._write_parts(ws, {"scoring": [{"id": "S1"}], "project": {"name": "P"}})
    assert ws.read_json("workspace/tender_parts/scoring.json") == {
        "scoring": [{"id": "S1"}]
    }
    assert ws.read_json("workspace/tender_parts/project.json") == {
        "project": {"name": "P"}
    }


@pytest.mark.asyncio
async def test_parse_happy_path(tmp_path):
    ws = BidWorkspace("p1", root=tmp_path)
    ws.write_tender_text("正文")

    async def sleuth(**k):
        return {"project": {"a": 1}, "scoring": [{"id": "S1"}]}

    def merge(_ws):
        _ws.write_json(
            "workspace/tender.json", _complete_tender(scoring=[{"id": "S1"}])
        )
        return 0, "ok"

    with (
        patch.object(pp, "run_segment", side_effect=_seed),
        patch.object(pp, "call_tender_sleuth", new=AsyncMock(side_effect=sleuth)),
        patch.object(pp, "run_merge", side_effect=merge),
    ):
        tender = await pp.parse_tender(ws, model="m", model_config=None)
    assert tender["scoring"][0]["id"] == "S1"
    assert ws.read_json("workspace/tender_parts/project.json") == {"project": {"a": 1}}


@pytest.mark.asyncio
async def test_advisory_merge_issues_accepted_without_retry(tmp_path):
    # All required blocks present but merge exits non-zero on advisory closure
    # warnings -> parse accepts it (human reviews) and does NOT retry.
    ws = BidWorkspace("p3", root=tmp_path)
    ws.write_tender_text("正文")
    calls = {"merge": 0}

    async def sleuth(**k):
        return {"project": {}}

    def merge(_ws):
        calls["merge"] += 1
        _ws.write_json(
            "workspace/tender.json",
            _complete_tender(_meta={"merge_issues": ["target_section 悬空"]}),
        )
        return 1, "advisory"

    with (
        patch.object(pp, "run_segment", side_effect=_seed),
        patch.object(pp, "call_tender_sleuth", new=AsyncMock(side_effect=sleuth)),
        patch.object(pp, "run_merge", side_effect=merge),
    ):
        tender = await pp.parse_tender(ws, model="m", model_config=None)
    assert calls["merge"] == 1  # accepted on first merge, no retry
    assert all(b in tender for b in pp._REQUIRED_BLOCKS)


@pytest.mark.asyncio
async def test_missing_blocks_retries_once_then_raises(tmp_path):
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


@pytest.mark.asyncio
async def test_merge_writes_no_file_raises_without_filenotfound(tmp_path):
    # Regression: retry path read tender.json unconditionally -> FileNotFoundError
    # -> 500. Now it degrades to the merge stderr and raises a clean pipeline error.
    ws = BidWorkspace("p4", root=tmp_path)
    ws.write_tender_text("正文")

    async def sleuth(**k):
        return {"project": {}}

    def merge(_ws):
        return 1, "merge crashed hard"  # writes NO tender.json

    with (
        patch.object(pp, "run_segment", side_effect=_seed),
        patch.object(pp, "call_tender_sleuth", new=AsyncMock(side_effect=sleuth)),
        patch.object(pp, "run_merge", side_effect=merge),
    ):
        with pytest.raises(pp.BidPipelineError) as ei:
            await pp.parse_tender(ws, model="m", model_config=None)
    assert "merge crashed hard" in str(ei.value)
