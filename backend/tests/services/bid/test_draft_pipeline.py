# SPDX-License-Identifier: Apache-2.0
"""Draft pipeline tests.

Phase 4 drafting runs as a ClaudeCode sandbox agent (Task 6). The legacy
per-section `call_ghostwriter`/`draft_all` path is replaced by
`run_drafting_sandbox`, which seeds the corpus into the sandbox, fires the agent
via /v1/responses, and reads sections back over envd. Single-section redraft
still uses the specialist path (deferred — unchanged here)."""

import asyncio
import json
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


def test_find_section():
    outline = {"sections": [{"id": "a", "children": [{"id": "a1"}]}, {"id": "b"}]}
    assert dp.find_section(outline, "a1")["id"] == "a1"
    assert dp.find_section(outline, "zzz") is None


@pytest.mark.asyncio
async def test_launch_drafting_schedules_under_running_loop():
    # launch_drafting uses asyncio.create_task wrapping _run_drafting_sandbox.
    with patch.object(
        dp, "_run_drafting_sandbox", new=AsyncMock(return_value=None)
    ) as run:
        dp.launch_drafting(1, 1, "m", None)
        await asyncio.sleep(0)  # let the scheduled task run
    run.assert_awaited_once()


# ---- redraft (specialist path, deferred from sandbox migration) --------------


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


# ---- sandbox drafting orchestration (Task 6) --------------------------------


def _ws_with_corpus(tmp_path, ref="sb1"):
    """Build a workspace with outline + tender + corpus files for seeding."""
    ws = BidWorkspace(ref, root=tmp_path)
    ws.write_json(
        "workspace/outline.json",
        {"sections": [{"id": "s1", "covers": []}, {"id": "s2", "covers": []}]},
    )
    ws.write_json("workspace/tender.json", {"scoring": [], "mandatory_clauses": []})
    ws.write_json("corpus/bidder_knowledge_base.json", {"bidder_knowledge_base": {}})
    ws.write_json("corpus/qualifications.json", {"items": []})
    ws.write_json("corpus/node_briefs.json", {"briefs": {}, "materials": []})
    (ws.path("corpus/attachments")).mkdir(parents=True, exist_ok=True)
    (ws.path("corpus/attachments/brochure.pdf")).write_bytes(b"PDF")
    return ws


@pytest.mark.asyncio
async def test_run_drafting_sandbox_seeds_runs_collects(tmp_path):
    ws = _ws_with_corpus(tmp_path)
    outline = ws.read_json("workspace/outline.json")

    # Mock the SandboxRuntime so the orchestration is exercised offline.
    rt = AsyncMock()
    rt.create.return_value = "sid-1"
    rt.wait_running.return_value = "http://localhost:10001"
    # Each section's await_file returns True, read_file returns its body.
    rt.await_file.return_value = True
    rt.read_file.side_effect = [
        b"BODY-S1",
        b"BODY-S2",
    ]

    with (
        patch("app.services.bid.draft_pipeline.SandboxRuntime", return_value=rt),
        patch(
            "app.services.bid.draft_pipeline.ensure_bid_skill_registered",
            return_value="bid-section-writer",
        ) as reg,
    ):
        await dp.run_drafting_sandbox(
            db=None,
            workspace=ws,
            outline=outline,
            project_id=30,
            user_id=1,
            user_name="admin",
            model="mimo-v2.5",
            model_config={"api_key": "k", "base_url": "u", "model_id": "mimo-v2.5"},
        )

    # Skill registered first (executor must be able to pull it).
    reg.assert_called_once()

    # Sandbox lifecycle order: create -> wait_running -> seed -> run_agent -> delete.
    rt.create.assert_awaited_once()
    rt.wait_running.assert_awaited_once()
    rt.run_agent.assert_awaited_once()
    rt.delete.assert_awaited_once()

    # Corpus was seeded (at least tender + outline + briefs + kb + quals + attachments).
    # seed_file(envd, remote_path, data, filename) — remote_path is the 2nd arg.
    seeded_paths = [c.args[1] for c in rt.seed_file.await_args_list]
    assert any("tender.json" in p for p in seeded_paths)
    assert any("outline.json" in p for p in seeded_paths)
    assert any("node_briefs.json" in p for p in seeded_paths)
    assert any("bidder_knowledge_base.json" in p for p in seeded_paths)
    assert any("attachments" in p for p in seeded_paths)

    # run_agent went to envd /v1/responses with metadata.bot carrying shell_type.
    agent_kwargs = rt.run_agent.await_args.kwargs
    assert agent_kwargs["prompt"] and agent_kwargs["instructions"]
    assert agent_kwargs["bot_env"]["env"]["model"] == "claude"
    assert agent_kwargs["task_id"] == dp.sc.synthetic_task_id(30)

    # Sections collected back to disk + status finished.
    assert ds.read_section(ws, "s1") == "BODY-S1"
    assert ds.read_section(ws, "s2") == "BODY-S2"
    st = ds.read_status(ws)
    assert st["finished"] is True
    assert set(st["sections"].values()) == {"done"}
    # Phase transition (set_phase_done) lives in the _run_drafting_sandbox
    # launcher wrapper, not in the pure orchestration function.


@pytest.mark.asyncio
async def test_run_drafting_sandbox_section_timeout_marks_error(tmp_path):
    ws = _ws_with_corpus(tmp_path, ref="sb2")
    outline = ws.read_json("workspace/outline.json")

    rt = AsyncMock()
    rt.create.return_value = "sid-2"
    rt.wait_running.return_value = "http://localhost:10001"
    rt.await_file.return_value = False  # section never appears -> error
    rt.read_file.return_value = None

    with (
        patch("app.services.bid.draft_pipeline.SandboxRuntime", return_value=rt),
        patch("app.services.bid.draft_pipeline.ensure_bid_skill_registered"),
    ):
        await dp.run_drafting_sandbox(
            db=None,
            workspace=ws,
            outline=outline,
            project_id=31,
            user_id=1,
            user_name="admin",
            model="m",
            model_config={"api_key": "k", "base_url": "u"},
        )

    st = ds.read_status(ws)
    # Section timed out -> marked error; run still cleaned up the sandbox.
    assert set(st["sections"].values()) == {"error"}
    rt.delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_drafting_sandbox_deletes_sandbox_on_agent_failure(tmp_path):
    ws = _ws_with_corpus(tmp_path, ref="sb3")
    outline = ws.read_json("workspace/outline.json")

    rt = AsyncMock()
    rt.create.return_value = "sid-3"
    rt.wait_running.return_value = "http://localhost:10001"
    rt.run_agent.side_effect = RuntimeError("/v1/responses failed 500")

    with (
        patch("app.services.bid.draft_pipeline.SandboxRuntime", return_value=rt),
        patch("app.services.bid.draft_pipeline.ensure_bid_skill_registered"),
    ):
        with pytest.raises(RuntimeError):
            await dp.run_drafting_sandbox(
                db=None,
                workspace=ws,
                outline=outline,
                project_id=32,
                user_id=1,
                user_name="admin",
                model="m",
                model_config={"api_key": "k", "base_url": "u"},
            )

    # Sandbox must be cleaned up even when the agent call blows up.
    rt.delete.assert_awaited_once()
