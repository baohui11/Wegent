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


def test_find_section():
    outline = {"sections": [{"id": "a", "children": [{"id": "a1"}]}, {"id": "b"}]}
    assert dp.find_section(outline, "a1")["id"] == "a1"
    assert dp.find_section(outline, "zzz") is None


@pytest.mark.asyncio
async def test_redraft_one_overwrites_and_marks_done(tmp_path):
    ws = BidWorkspace("rd1", root=tmp_path)
    ws.write_json("workspace/outline.json", {"sections": [{"id": "s1", "covers": []}]})
    ws.write_json("workspace/tender.json", {})
    ds.init_status(ws, ["s1"])
    with patch.object(
        dp, "call_ghostwriter", new=AsyncMock(return_value="改写后的正文")
    ) as m:
        await dp.redraft_one(
            ws, "s1", model="m", model_config=None, instruction="更简洁"
        )
    assert ds.read_section(ws, "s1") == "改写后的正文"
    assert ds.read_status(ws)["sections"]["s1"] == "done"
    assert m.await_args.kwargs["instruction"] == "更简洁"


@pytest.mark.asyncio
async def test_redraft_one_missing_section_marks_error(tmp_path):
    ws = BidWorkspace("rd2", root=tmp_path)
    ws.write_json("workspace/outline.json", {"sections": []})
    ws.write_json("workspace/tender.json", {})
    ds.init_status(ws, ["s1"])
    await dp.redraft_one(ws, "s1", model="m", model_config=None, instruction=None)
    assert ds.read_status(ws)["sections"]["s1"] == "error"


@pytest.mark.asyncio
async def test_launch_redraft_schedules_under_running_loop():
    with patch.object(dp, "_run_redraft", new=AsyncMock(return_value=None)) as run:
        dp.launch_redraft(1, 1, "s1", None, "m", None)
        await asyncio.sleep(0)
    run.assert_awaited_once()


@pytest.mark.asyncio
async def test_draft_all_passes_node_brief(tmp_path):
    from app.services.bid import materials_service as ms

    ws = BidWorkspace("dp-brief", root=tmp_path)
    ws.write_json("workspace/outline.json", {"sections": [{"id": "s1", "covers": []}]})
    ws.write_json("workspace/tender.json", {})
    ms.write_briefs(ws, {"briefs": {"s1": {"requirements": "重点写安全"}}})
    mock = AsyncMock(return_value="正文")
    with patch.object(dp, "call_ghostwriter", new=mock):
        await dp.draft_all(ws, model="m", model_config=None)
    assert mock.call_args.kwargs["brief"] == {"requirements": "重点写安全"}


@pytest.mark.asyncio
async def test_draft_all_brief_none_when_unset(tmp_path):
    ws = BidWorkspace("dp-nobrief", root=tmp_path)
    ws.write_json("workspace/outline.json", {"sections": [{"id": "s1", "covers": []}]})
    ws.write_json("workspace/tender.json", {})
    mock = AsyncMock(return_value="正文")
    with patch.object(dp, "call_ghostwriter", new=mock):
        await dp.draft_all(ws, model="m", model_config=None)
    assert mock.call_args.kwargs["brief"] is None


@pytest.mark.asyncio
async def test_draft_all_honors_pause(tmp_path, monkeypatch):
    monkeypatch.setattr(dp, "PAUSE_POLL_SECONDS", 0.01)
    ws = BidWorkspace("dp-pause", root=tmp_path)
    ws.write_json(
        "workspace/outline.json",
        {"sections": [{"id": "s1", "covers": []}, {"id": "s2", "covers": []}]},
    )
    ws.write_json("workspace/tender.json", {})
    mock = AsyncMock(return_value="正文")
    with patch.object(dp, "call_ghostwriter", new=mock):
        # draft_all's init_status resets paused, so pause right after start.
        task = asyncio.create_task(
            dp.draft_all(ws, model="m", model_config=None, concurrency=1)
        )
        await asyncio.sleep(0)  # let init_status run
        ds.set_paused(ws, True)
        await asyncio.sleep(0.1)
        called_while_paused = mock.call_count
        ds.set_paused(ws, False)
        await asyncio.wait_for(task, timeout=5)
    # At most the in-flight section proceeded; after resume all complete.
    assert called_while_paused <= 1
    st = ds.read_status(ws)
    assert st["finished"] is True and set(st["sections"].values()) == {"done"}
