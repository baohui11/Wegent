# SPDX-License-Identifier: Apache-2.0
"""Draft pipeline tests.

Phase 4 drafting runs as a backend-orchestrated parallel fan-out: one stateless
``call_ghostwriter`` per outline section, importance-ordered and concurrency-
capped. Single-section redraft reuses the same ``call_ghostwriter`` with an
extra instruction."""

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


def test_find_section():
    outline = {"sections": [{"id": "a", "children": [{"id": "a1"}]}, {"id": "b"}]}
    assert dp.find_section(outline, "a1")["id"] == "a1"
    assert dp.find_section(outline, "zzz") is None


@pytest.mark.asyncio
async def test_launch_drafting_schedules_under_running_loop():
    # launch_drafting uses asyncio.create_task wrapping _run_drafting_parallel.
    with patch.object(
        dp, "_run_drafting_parallel", new=AsyncMock(return_value=None)
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


# ---- full-draft prompt enforces per-node writing brief ------------------------


@pytest.mark.asyncio
async def test_redraft_one_feeds_normalized_tender(tmp_path):
    from unittest.mock import AsyncMock, patch

    from app.services.bid import draft_pipeline
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("redraft-norm", root=tmp_path)
    ws.write_json(
        "workspace/outline.json",
        {"sections": [{"id": "s1", "title": "方案", "covers": ["T1"]}]},
    )
    ws.write_json(
        "workspace/tender.json",
        {
            "scoring": {"tech_items": [{"id": "T1", "title": "方案", "max_score": 20}]},
            "mandatory_clauses": [],
        },
    )
    with patch.object(
        draft_pipeline, "call_ghostwriter", new=AsyncMock(return_value="正文")
    ) as gw:
        await draft_pipeline.redraft_one(
            ws, "s1", model="m", model_config=None, instruction=None
        )
    passed_tender = gw.await_args.kwargs["tender"]
    assert isinstance(passed_tender["scoring"], list)  # normalized, not bucketed dict
    assert ws.path("workspace/tender_normalized.json").exists()


def test_section_importance_key_veto_first_then_weight():
    from app.services.bid.draft_pipeline import _section_importance_key

    tender = {
        "scoring": [{"id": "T1", "weight": 20}, {"id": "T2", "weight": 5}],
        "mandatory_clauses": [{"id": "M1", "veto": True}],
    }
    veto_node = {"id": "a", "covers": ["M1"]}
    heavy_node = {"id": "b", "covers": ["T1"]}
    light_node = {"id": "c", "covers": ["T2"]}
    plain_node = {"id": "d", "covers": []}

    keys = {
        n["id"]: _section_importance_key(n, tender)
        for n in (veto_node, heavy_node, light_node, plain_node)
    }
    ordered = sorted(keys, key=lambda i: keys[i])
    assert ordered == ["a", "b", "c", "d"]  # veto → heavy → light → none


@pytest.mark.asyncio
async def test_run_drafting_parallel_drafts_all_and_isolates_failure(tmp_path):
    from unittest.mock import AsyncMock, patch

    from app.services.bid import draft_pipeline as dp
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("parallel-draft", root=tmp_path)
    ws.write_json("workspace/tender.json", {"scoring": [], "mandatory_clauses": []})
    outline = {
        "sections": [
            {"id": "s1", "title": "一", "covers": []},
            {"id": "s2", "title": "二", "covers": []},
            {"id": "s3", "title": "三", "covers": []},
        ]
    }

    async def fake_gw(**kw):
        if str(kw["section"]["id"]) == "s2":
            raise RuntimeError("boom")
        return f"正文-{kw['section']['id']}"

    with patch.object(dp, "call_ghostwriter", new=AsyncMock(side_effect=fake_gw)):
        await dp.run_drafting_parallel(
            ws=ws,
            outline=outline,
            model="m",
            model_config=None,
            project_id=1,
            user_id=2,
        )

    st = dp.ds.read_status(ws)
    assert st["finished"] is True
    assert st["sections"]["s1"] == "done"
    assert st["sections"]["s3"] == "done"
    assert st["sections"]["s2"] == "error"  # isolated failure
    assert ws.path("workspace/sections/s1.md").read_text(encoding="utf-8") == "正文-s1"
    assert not ws.path("workspace/sections/s2.md").exists()


@pytest.mark.asyncio
async def test_draft_section_passes_retrieved_materials(tmp_path):
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.services.bid import draft_pipeline as dp
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("draft-retr", root=tmp_path)
    ws.write_json("workspace/tender.json", {"scoring": [], "mandatory_clauses": []})
    ws.write_json("corpus/node_briefs.json", {"briefs": {}, "materials": []})

    captured = {}

    async def fake_gw(**kw):
        captured.update(kw)
        return "正文"

    hits = [{"name": "q.md", "scope": "global", "summary": "命中片段"}]
    with (
        patch.object(dp, "call_ghostwriter", new=AsyncMock(side_effect=fake_gw)),
        patch.object(dp.section_retrieval, "retrieve_for_section", return_value=hits),
    ):
        await dp._draft_section(
            asyncio.Semaphore(1),
            ws,
            {"id": "s1", "title": "方案"},
            tender={"scoring": [], "mandatory_clauses": []},
            kb={},
            model="m",
            model_config=None,
            project_id=1,
            user_id=2,
        )
    assert captured["materials"] == hits


@pytest.mark.asyncio
async def test_draft_section_retries_then_needs_rework(tmp_path):
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.services.bid import draft_pipeline as dp
    from app.services.bid import drafting_service as ds
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("gate-draft", root=tmp_path)
    ws.write_json("workspace/tender.json", {"scoring": [], "mandatory_clauses": []})
    ws.write_json(
        "corpus/node_briefs.json",
        {"briefs": {"s1": {"wordMin": "500"}}, "materials": []},
    )
    ds.init_status(ws, ["s1"])

    # ghostwriter always returns a too-short draft -> gate fails both times
    with (
        patch.object(dp, "call_ghostwriter", new=AsyncMock(return_value="太短")),
        patch.object(dp.section_retrieval, "retrieve_for_section", return_value=[]),
    ):
        await dp._draft_section(
            asyncio.Semaphore(1),
            ws,
            {"id": "s1", "title": "方案"},
            tender={"scoring": [], "mandatory_clauses": []},
            kb={},
            model="m",
            model_config=None,
            project_id=1,
            user_id=2,
        )
        assert ds.read_status(ws)["sections"]["s1"] == "needs_rework"
        assert dp.call_ghostwriter.await_count == 2  # drafted once + retried once
        assert "s1" in dp.post_gate.read_issues(ws)  # issues recorded


@pytest.mark.asyncio
async def test_draft_section_retry_recovers_to_done(tmp_path):
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.services.bid import draft_pipeline as dp
    from app.services.bid import drafting_service as ds
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("gate-draft2", root=tmp_path)
    ws.write_json("workspace/tender.json", {"scoring": [], "mandatory_clauses": []})
    ws.write_json(
        "corpus/node_briefs.json",
        {"briefs": {"s1": {"wordMin": "20"}}, "materials": []},
    )
    ds.init_status(ws, ["s1"])

    good = "达标正文" * 50
    with (
        patch.object(dp, "call_ghostwriter", new=AsyncMock(side_effect=["短", good])),
        patch.object(dp.section_retrieval, "retrieve_for_section", return_value=[]),
    ):
        await dp._draft_section(
            asyncio.Semaphore(1),
            ws,
            {"id": "s1", "title": "方案"},
            tender={"scoring": [], "mandatory_clauses": []},
            kb={},
            model="m",
            model_config=None,
            project_id=1,
            user_id=2,
        )
        assert ds.read_status(ws)["sections"]["s1"] == "done"
        assert dp.call_ghostwriter.await_count == 2


# ---- draft unit = top-level chapters only (P0 fix) --------------------------


def test_top_level_sections_excludes_leaves():
    # After a stage-1 outline edit, leaves carry ids too — draft units must
    # still be top-level chapters only.
    outline = {
        "sections": [
            {
                "id": "a",
                "title": "第一章",
                "children": [
                    {"id": "a1", "title": "小节A"},
                    {"id": "a2", "title": "小节B"},
                ],
            },
            {"id": "b", "title": "第二章"},
        ]
    }
    assert [s["id"] for s in dp.top_level_sections(outline)] == ["a", "b"]


@pytest.mark.asyncio
async def test_run_drafting_parallel_fans_out_top_level_only(tmp_path, monkeypatch):
    ws = BidWorkspace("p0", root=tmp_path)
    outline = {
        "sections": [
            {
                "id": "s1",
                "title": "第一章",
                "children": [
                    {"id": "s1.1", "title": "小节A"},
                    {"id": "s1.2", "title": "小节B"},
                ],
            },
            {"id": "s2", "title": "第二章"},
        ]
    }
    ws.write_json("workspace/tender_normalized.json", {"scoring": [], "clauses": []})
    monkeypatch.setattr(
        dp, "ensure_normalized_tender", lambda w: "workspace/tender_normalized.json"
    )
    monkeypatch.setattr(dp, "_section_importance_key", lambda n, t: (1, 0.0))
    monkeypatch.setattr(dp, "_draft_section", AsyncMock(return_value=None))

    await dp.run_drafting_parallel(
        ws=ws, outline=outline, model="m", model_config=None, project_id=1, user_id=1
    )

    keys = set(ds.read_status(ws)["sections"].keys())
    assert keys == {"s1", "s2"}  # NOT s1.1 / s1.2


@pytest.mark.asyncio
async def test_redraft_one_reads_stage3_outline(tmp_path, monkeypatch):
    ws = BidWorkspace("rd-s3", root=tmp_path)
    # stage1 lacks the node; stage3 has it — redraft must find it via stage3.
    ws.write_json("workspace/outline.json", {"sections": [], "volumes": []})
    ws.write_json(
        "workspace/outline_stage3.json",
        {"sections": [{"id": "s1", "title": "只在 stage3 的章"}], "volumes": []},
    )
    ws.write_json("workspace/tender_normalized.json", {"scoring": [], "clauses": []})
    monkeypatch.setattr(
        dp, "ensure_normalized_tender", lambda w: "workspace/tender_normalized.json"
    )
    seen = {}

    async def _gw(**kwargs):
        seen["title"] = kwargs["section"].get("title")
        return "正文"

    monkeypatch.setattr(dp, "call_ghostwriter", _gw)
    monkeypatch.setattr(
        dp.section_retrieval, "retrieve_for_section", lambda *a, **k: []
    )
    await dp.redraft_one(ws, "s1", model="m", model_config=None, instruction=None)
    assert seen["title"] == "只在 stage3 的章"
    assert ds.read_status(ws)["sections"]["s1"] == "done"


@pytest.mark.asyncio
async def test_draft_section_backfills_missing_leaf_headings(tmp_path, monkeypatch):
    ws = BidWorkspace("c1-backfill", root=tmp_path)
    node = {
        "id": "s1",
        "title": "第一章",
        "children": [{"title": "小节甲"}, {"title": "小节乙"}],
    }

    async def _fake_write_and_check(ws_, node_, sid_, *, instruction, **kw):
        # Simulate a ghostwriter that wrote only 甲 (乙 missing); gate is otherwise ok.
        ws_.path(f"workspace/sections/{sid_}.md").parent.mkdir(
            parents=True, exist_ok=True
        )
        ws_.path(f"workspace/sections/{sid_}.md").write_text(
            "## 小节甲\n正文足够长。", encoding="utf-8"
        )
        return {"ok": True, "issues": []}

    monkeypatch.setattr(dp, "_write_and_check", _fake_write_and_check)
    sem = asyncio.Semaphore(1)
    monkeypatch.setattr(dp.materials_service, "read_briefs", lambda w: {"briefs": {}})
    await dp._draft_section(
        sem,
        ws,
        node,
        tender={},
        kb={},
        model="m",
        model_config=None,
        project_id=1,
        user_id=1,
    )
    body = ws.path("workspace/sections/s1.md").read_text(encoding="utf-8")
    assert "## 小节乙" in body  # backfilled
    assert "待填（来源：..）" in body  # as a 🅓 placeholder
    assert ds.read_status(ws)["sections"]["s1"] == "done"
