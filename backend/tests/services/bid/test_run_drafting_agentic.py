# SPDX-License-Identifier: Apache-2.0
"""End-to-end fan-out test for agentic drafting mode (Phase 2). Drives the real
``run_drafting_parallel`` with the sidecar + ghostwriter mocked: section 'a' is
adopted from the agent, section 'b' falls back to the deterministic ghostwriter.
Both sections complete -> 100% completion regardless of agent success."""

import pytest

from app.services.bid import draft_pipeline as dp
from app.services.bid.workspace import BidWorkspace


@pytest.mark.asyncio
async def test_fanout_agentic_all_sections_complete_with_mixed_fallback(
    tmp_path, monkeypatch
):
    ws = BidWorkspace("wref", root=tmp_path)
    ws.path("workspace/sections").mkdir(parents=True, exist_ok=True)
    ws.path("workspace").mkdir(parents=True, exist_ok=True)
    outline = {"sections": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}]}

    monkeypatch.setattr(dp.settings, "BID_DRAFTING_MODE", "agentic")
    monkeypatch.setattr(dp.settings, "BID_AGENTIC_USABLE_MIN", 5)
    monkeypatch.setattr(dp, "ensure_normalized_tender", lambda ws: "workspace/t.json")

    # Only stub the tender + knowledge-base reads (empty); let the drafting
    # status file round-trip through the real read_json.
    _empty_reads = {"workspace/t.json", "corpus/bidder_knowledge_base.json"}
    _real_read_json = ws.read_json

    def _read_json(rel):
        if rel in _empty_reads:
            return {}
        return _real_read_json(rel)

    monkeypatch.setattr(ws, "read_json", _read_json)
    monkeypatch.setattr(dp, "flatten_sections", lambda o: o["sections"])
    monkeypatch.setattr(dp, "_section_importance_key", lambda n, t: 0)
    monkeypatch.setattr(dp.materials_service, "read_briefs", lambda ws: {"briefs": {}})
    monkeypatch.setattr(
        dp.agentic_draft_client, "mount_section_writer_skill", lambda ws: None
    )
    monkeypatch.setattr(dp, "build_agentic_prompt", lambda *a, **k: "P")
    monkeypatch.setattr(
        dp.post_gate, "check_section", lambda *a, **k: {"ok": True, "issues": []}
    )
    monkeypatch.setattr(
        dp.section_retrieval, "retrieve_for_section", lambda *a, **k: []
    )

    async def sidecar(**kw):  # section 'a' succeeds, 'b' returns thin -> fallback
        if kw["section_id"] == "a":
            ws.path("workspace/sections/a.md").write_text("正文" * 10, encoding="utf-8")
            return {"status": "agent"}
        return {"status": "timeout"}

    monkeypatch.setattr(dp.agentic_draft_client, "draft_via_sidecar", sidecar)

    async def gw(**kw):
        return "回退" * 200

    monkeypatch.setattr(dp, "call_ghostwriter", gw)

    await dp.run_drafting_parallel(
        ws=ws,
        outline=outline,
        model="m",
        model_config={"base_url": "u", "api_key": "k"},
        project_id=1,
        user_id=1,
    )

    assert "正文" in ws.path("workspace/sections/a.md").read_text()  # agent
    assert "回退" in ws.path("workspace/sections/b.md").read_text()  # fallback
    # both sections present => 100% completion regardless of agent success
