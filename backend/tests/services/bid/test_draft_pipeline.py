# SPDX-License-Identifier: Apache-2.0
import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid import draft_pipeline as dp
from app.services.bid import drafting_service as ds
from app.services.bid.workspace import BidWorkspace


def test_flatten_nested():
    outline = {
        "sections": [
            {"id": "a", "children": [{"id": "a1"}, {"id": "a2"}]},
            {"id": "b"},
        ]
    }
    assert [s["id"] for s in dp.flatten_sections(outline)] == ["a", "a1", "a2", "b"]


@pytest.mark.asyncio
async def test_draft_all_writes_sections_and_status(tmp_path):
    ws = BidWorkspace("dp1", root=tmp_path)
    ws.write_json(
        "workspace/outline.json",
        {"sections": [{"id": "s1", "covers": []}, {"id": "s2", "covers": []}]},
    )
    ws.write_json("workspace/tender.json", {"scoring": [], "mandatory_clauses": []})
    with patch.object(
        dp,
        "call_ghostwriter",
        new=AsyncMock(side_effect=lambda **k: f"正文-{k['section']['id']}"),
    ):
        await dp.draft_all(ws, model="m", model_config=None, concurrency=2)
    assert ds.read_section(ws, "s1") == "正文-s1"
    assert ds.read_section(ws, "s2") == "正文-s2"
    st = ds.read_status(ws)
    assert st["finished"] is True and st["sections"] == {
        "s1": "done",
        "s2": "done",
    }


@pytest.mark.asyncio
async def test_draft_all_marks_section_error(tmp_path):
    ws = BidWorkspace("dp2", root=tmp_path)
    ws.write_json("workspace/outline.json", {"sections": [{"id": "s1", "covers": []}]})
    ws.write_json("workspace/tender.json", {})
    with patch.object(
        dp, "call_ghostwriter", new=AsyncMock(side_effect=RuntimeError("boom"))
    ):
        await dp.draft_all(ws, model="m", model_config=None)
    assert ds.read_status(ws)["sections"]["s1"] == "error"


@pytest.mark.asyncio
async def test_launch_drafting_schedules_under_running_loop():
    # Regression: launch_drafting uses asyncio.create_task, which requires a
    # running event loop. Called from an async context (as the async /draft
    # endpoint does) it must schedule without RuntimeError.
    with patch.object(dp, "_run_drafting", new=AsyncMock(return_value=None)) as run:
        dp.launch_drafting(1, 1, "m", None)
        await asyncio.sleep(0)  # let the scheduled task run
    run.assert_awaited_once()
