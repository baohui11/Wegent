# SPDX-License-Identifier: Apache-2.0
"""Agentic first-pass integration tests for draft_pipeline._write_and_check
(Phase 2). All sidecar / ghostwriter calls are mocked — no network."""

import pytest

from app.services.bid import draft_pipeline as dp
from app.services.bid.workspace import BidWorkspace


def _ws(tmp_path):
    ws = BidWorkspace("wref", root=tmp_path)
    ws.path("workspace/sections").mkdir(parents=True, exist_ok=True)
    return ws


def _kw():
    return dict(
        brief=None,
        tender={},
        kb={},
        model="m",
        model_config={"base_url": "u", "api_key": "k"},
        project_id=1,
        user_id=1,
    )


@pytest.mark.asyncio
async def test_agentic_first_pass_adopts_usable_draft(tmp_path, monkeypatch):
    ws = _ws(tmp_path)
    node = {"id": "s1", "title": "T"}
    monkeypatch.setattr(dp.settings, "BID_DRAFTING_MODE", "agentic")
    monkeypatch.setattr(dp.settings, "BID_AGENTIC_USABLE_MIN", 5)
    monkeypatch.setattr(
        dp.agentic_draft_client, "mount_section_writer_skill", lambda ws: None
    )
    monkeypatch.setattr(dp, "build_agentic_prompt", lambda *a, **k: "PROMPT")

    async def fake_sidecar(**kw):
        ws.path("workspace/sections/s1.md").write_text(
            "真实正文" * 10, encoding="utf-8"
        )
        return {"status": "agent", "section_chars": 40}

    monkeypatch.setattr(dp.agentic_draft_client, "draft_via_sidecar", fake_sidecar)

    called = {"gw": 0}

    async def fake_gw(**kw):
        called["gw"] += 1
        return "GW"

    monkeypatch.setattr(dp, "call_ghostwriter", fake_gw)
    monkeypatch.setattr(
        dp.post_gate, "check_section", lambda *a, **k: {"ok": True, "issues": []}
    )
    monkeypatch.setattr(
        dp.section_retrieval, "retrieve_for_section", lambda *a, **k: []
    )

    r = await dp._write_and_check(ws, node, "s1", instruction=None, **_kw())
    assert r["ok"] is True
    assert called["gw"] == 0  # agent draft adopted, no fallback
    assert "真实正文" in ws.path("workspace/sections/s1.md").read_text()


@pytest.mark.asyncio
async def test_agentic_thin_output_falls_back_to_ghostwriter(tmp_path, monkeypatch):
    ws = _ws(tmp_path)
    node = {"id": "s1", "title": "T"}
    monkeypatch.setattr(dp.settings, "BID_DRAFTING_MODE", "agentic")
    monkeypatch.setattr(dp.settings, "BID_AGENTIC_USABLE_MIN", 500)
    monkeypatch.setattr(
        dp.agentic_draft_client, "mount_section_writer_skill", lambda ws: None
    )
    monkeypatch.setattr(dp, "build_agentic_prompt", lambda *a, **k: "PROMPT")

    async def fake_sidecar(**kw):  # writes nothing usable (timeout-ish)
        return {"status": "timeout", "section_chars": 0}

    monkeypatch.setattr(dp.agentic_draft_client, "draft_via_sidecar", fake_sidecar)

    async def fake_gw(**kw):
        return "回退正文" * 200

    monkeypatch.setattr(dp, "call_ghostwriter", fake_gw)
    monkeypatch.setattr(
        dp.post_gate, "check_section", lambda *a, **k: {"ok": True, "issues": []}
    )
    monkeypatch.setattr(
        dp.section_retrieval, "retrieve_for_section", lambda *a, **k: []
    )

    r = await dp._write_and_check(ws, node, "s1", instruction=None, **_kw())
    assert r["ok"] is True
    # fallback wrote it
    assert "回退正文" in ws.path("workspace/sections/s1.md").read_text()


@pytest.mark.asyncio
async def test_sidecar_exception_falls_back(tmp_path, monkeypatch):
    ws = _ws(tmp_path)
    node = {"id": "s1", "title": "T"}
    monkeypatch.setattr(dp.settings, "BID_DRAFTING_MODE", "agentic")
    monkeypatch.setattr(
        dp.agentic_draft_client, "mount_section_writer_skill", lambda ws: None
    )
    monkeypatch.setattr(dp, "build_agentic_prompt", lambda *a, **k: "PROMPT")

    async def boom(**kw):
        raise RuntimeError("sidecar down")

    monkeypatch.setattr(dp.agentic_draft_client, "draft_via_sidecar", boom)

    async def fake_gw(**kw):
        return "回退正文" * 200

    monkeypatch.setattr(dp, "call_ghostwriter", fake_gw)
    monkeypatch.setattr(
        dp.post_gate, "check_section", lambda *a, **k: {"ok": True, "issues": []}
    )
    monkeypatch.setattr(
        dp.section_retrieval, "retrieve_for_section", lambda *a, **k: []
    )

    r = await dp._write_and_check(ws, node, "s1", instruction=None, **_kw())
    assert r["ok"] is True
    assert "回退正文" in ws.path("workspace/sections/s1.md").read_text()


@pytest.mark.asyncio
async def test_retry_pass_uses_ghostwriter_not_agentic(tmp_path, monkeypatch):
    # instruction != None (post_gate rework) must use the deterministic path
    ws = _ws(tmp_path)
    node = {"id": "s1", "title": "T"}
    monkeypatch.setattr(dp.settings, "BID_DRAFTING_MODE", "agentic")
    called = {"sidecar": 0}

    async def fake_sidecar(**kw):
        called["sidecar"] += 1
        return {"status": "agent"}

    monkeypatch.setattr(dp.agentic_draft_client, "draft_via_sidecar", fake_sidecar)

    async def fake_gw(**kw):
        return "返工正文" * 200

    monkeypatch.setattr(dp, "call_ghostwriter", fake_gw)
    monkeypatch.setattr(
        dp.post_gate, "check_section", lambda *a, **k: {"ok": True, "issues": []}
    )
    monkeypatch.setattr(
        dp.section_retrieval, "retrieve_for_section", lambda *a, **k: []
    )

    r = await dp._write_and_check(ws, node, "s1", instruction="修正X", **_kw())
    assert called["sidecar"] == 0  # retry never calls the sidecar
    assert "返工正文" in ws.path("workspace/sections/s1.md").read_text()
    assert r["ok"] is True


@pytest.mark.asyncio
async def test_pipeline_mode_skips_agentic_branch(tmp_path, monkeypatch):
    # BID_DRAFTING_MODE=pipeline (default) -> never touches the sidecar.
    ws = _ws(tmp_path)
    node = {"id": "s1", "title": "T"}
    monkeypatch.setattr(dp.settings, "BID_DRAFTING_MODE", "pipeline")
    called = {"sidecar": 0}

    async def fake_sidecar(**kw):
        called["sidecar"] += 1
        return {"status": "agent"}

    monkeypatch.setattr(dp.agentic_draft_client, "draft_via_sidecar", fake_sidecar)

    async def fake_gw(**kw):
        return "管道正文" * 200

    monkeypatch.setattr(dp, "call_ghostwriter", fake_gw)
    monkeypatch.setattr(
        dp.post_gate, "check_section", lambda *a, **k: {"ok": True, "issues": []}
    )
    monkeypatch.setattr(
        dp.section_retrieval, "retrieve_for_section", lambda *a, **k: []
    )

    r = await dp._write_and_check(ws, node, "s1", instruction=None, **_kw())
    assert called["sidecar"] == 0
    assert "管道正文" in ws.path("workspace/sections/s1.md").read_text()
    assert r["ok"] is True
