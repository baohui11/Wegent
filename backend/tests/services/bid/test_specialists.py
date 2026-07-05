# SPDX-License-Identifier: Apache-2.0
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid.specialists import ROUTE_MAP, call_tender_sleuth


@pytest.mark.asyncio
async def test_calls_once_per_block_and_keys_by_toplevel(monkeypatch):
    # Each block returns a {top-level key: {...}} JSON.
    async def fake_create(**kwargs):
        block = kwargs["metadata"]["block"]
        return json.dumps({block: {"ok": True}}, ensure_ascii=False)

    with patch(
        "app.services.bid.specialists.create_response",
        new=AsyncMock(side_effect=fake_create),
    ) as m:
        parts = await call_tender_sleuth(
            model="m",
            model_config={"model_type": "claude", "base_url": "u", "api_key": "k"},
            manifest={"segments": [{"file": "seg_001.txt", "route_tags": ["scoring"]}]},
            segments={"seg_001.txt": "片段"},
            regions={},
            veto={"candidates": []},
            bid_config={},
        )
    # Call count == ROUTE_MAP block count; keys are top-level block names.
    assert m.await_count == len(ROUTE_MAP)
    assert "scoring" in parts and parts["scoring"]["ok"] is True
    # system prompt comes from the vendor file.
    assert "拆标神探" in m.await_args.kwargs["instructions"]


@pytest.mark.asyncio
async def test_strips_code_fence():
    async def fake(**k):
        return (
            "```json\n"
            + json.dumps({k["metadata"]["block"]: {}}, ensure_ascii=False)
            + "\n```"
        )

    with patch(
        "app.services.bid.specialists.create_response",
        new=AsyncMock(side_effect=fake),
    ):
        parts = await call_tender_sleuth(
            model="m",
            model_config=None,
            manifest={},
            segments={},
            regions={},
            veto={},
            bid_config={},
        )
    assert "project" in parts


from app.services.bid.specialists import call_ghostwriter


@pytest.mark.asyncio
async def test_call_ghostwriter_returns_markdown():
    with patch(
        "app.services.bid.specialists.create_response",
        new=AsyncMock(return_value="## 一、总体方案\n正文……"),
    ) as m:
        md = await call_ghostwriter(
            model="m",
            model_config=None,
            section={
                "id": "s1",
                "title": "总体方案",
                "covers": ["S1"],
                "must_keep": ["闭环管理"],
            },
            tender={
                "scoring": [{"id": "S1", "target_section": "总体方案"}],
                "mandatory_clauses": [{"id": "V1", "veto": True, "text": "须盖章"}],
            },
            knowledge_base={"bidder_knowledge_base": {}},
        )
    assert md.startswith("## 一、总体方案")
    # system prompt contains the ghostwriter identity + style bible snippet
    kw = m.await_args.kwargs
    assert "标书枪手" in kw["instructions"]


@pytest.mark.asyncio
async def test_call_ghostwriter_strips_fence():
    with patch(
        "app.services.bid.specialists.create_response",
        new=AsyncMock(return_value="```markdown\n正文\n```"),
    ):
        md = await call_ghostwriter(
            model="m",
            model_config=None,
            section={"id": "s1", "title": "T", "covers": []},
            tender={},
            knowledge_base={},
        )
    assert md == "正文"


@pytest.mark.asyncio
async def test_call_ghostwriter_includes_instruction():
    with patch(
        "app.services.bid.specialists.create_response",
        new=AsyncMock(return_value="正文"),
    ) as m:
        await call_ghostwriter(
            model="m",
            model_config=None,
            section={"id": "s1", "title": "T", "covers": []},
            tender={},
            knowledge_base={},
            instruction="语言更简洁，补充业绩数据",
        )
    assert "语言更简洁，补充业绩数据" in m.await_args.kwargs["instructions"]


def test_route_map_tags_match_segmenter_vocabulary():
    # segment_tender.py only emits these route_tags (plus "unrouted"); any
    # other tag in ROUTE_MAP silently matches nothing and falls back to
    # feeding ALL segments to the LLM.
    from pathlib import Path

    from app.services.bid import specialists

    kw = json.loads(
        (
            Path(specialists.__file__).parent
            / "vendor"
            / "skills"
            / "tender-parser"
            / "references"
            / "segment_keywords.json"
        ).read_text(encoding="utf-8")
    )
    vocab = set(kw["route_keywords"].keys()) | {"unrouted"}
    for block, cfg in specialists.ROUTE_MAP.items():
        assert (
            set(cfg["tags"]) <= vocab
        ), f"{block}: unknown tags {set(cfg['tags']) - vocab}"


def test_route_segments_picks_tagged_subset():
    from app.services.bid.specialists import _route_segments

    manifest = {
        "segments": [
            {"file": "a.md", "route_tags": ["scoring"]},
            {"file": "b.md", "route_tags": ["unrouted"]},
            {"file": "c.md", "route_tags": ["mandatory_clauses"]},
        ]
    }
    segments = {"a.md": "A", "b.md": "B", "c.md": "C"}
    # tag hit -> strict subset, no fallback
    assert _route_segments(manifest, segments, ["scoring"], False) == {"a.md": "A"}
    # "unrouted" usable directly as a tag
    assert _route_segments(manifest, segments, ["unrouted"], False) == {"b.md": "B"}
    # include_unrouted (veto blocks) adds unrouted segments
    assert _route_segments(manifest, segments, ["scoring"], True) == {
        "a.md": "A",
        "b.md": "B",
    }


def test_fit_budget_untouched_when_under():
    from app.services.bid.specialists import _fit_budget

    ctx = {"a": "x" * 10, "b": "y" * 10}
    assert _fit_budget(ctx, ["a"], budget=10_000) == ctx


def test_fit_budget_shrinks_in_priority_order():
    from app.services.bid.specialists import _fit_budget

    ctx = {"keep": "k" * 50, "first": "f" * 500, "second": "s" * 500}
    out = _fit_budget(ctx, ["first", "second"], budget=700)
    # "first" is truncated/dropped before "second" is touched; "keep" never.
    assert out["keep"] == ctx["keep"]
    assert len(json.dumps(out, ensure_ascii=False)) <= 700 + 20  # marker slack
    assert out.get("second") == ctx["second"] or "…[truncated]" in str(
        out.get("first", "")
    )


def test_fit_budget_drops_key_when_zero_room():
    from app.services.bid.specialists import _fit_budget

    ctx = {"keep": "k" * 100, "big": "b" * 1000}
    out = _fit_budget(ctx, ["big"], budget=120)
    assert "big" not in out or len(str(out["big"])) < 1000
    assert out["keep"] == ctx["keep"]


@pytest.mark.asyncio
async def test_complete_ctx_retries_on_context_error():
    from app.services.bid import specialists

    calls = []

    async def fake_create(**kw):
        calls.append(kw)
        if len(calls) == 1:
            raise RuntimeError("This model's maximum context length is exceeded")
        return "ok"

    with patch.object(specialists, "create_response", new=fake_create):
        out = await specialists._complete_ctx(
            model="m",
            model_config=None,
            ctx={"keep": "k", "big": "b" * 100},
            shrink_order=["big"],
            instructions="i",
            metadata={},
            specialist="tender_sleuth",
            project_id=None,
            user_id=None,
        )
    assert out == "ok" and len(calls) == 2


@pytest.mark.asyncio
async def test_complete_ctx_reraises_non_context_error():
    from app.services.bid import specialists

    with patch.object(
        specialists, "create_response", new=AsyncMock(side_effect=RuntimeError("boom"))
    ):
        with pytest.raises(RuntimeError, match="boom"):
            await specialists._complete_ctx(
                model="m",
                model_config=None,
                ctx={"a": 1},
                shrink_order=[],
                instructions="i",
                metadata={},
                specialist="ghostwriter",
                project_id=None,
                user_id=None,
            )


@pytest.mark.asyncio
async def test_complete_ctx_records_llm_call():
    from app.services.bid import specialists

    async def fake_create(**kw):
        return "answer"  # extract_response_text passes strings through

    with (
        patch.object(specialists, "create_response", new=fake_create),
        patch.object(specialists.llm_log, "record") as rec,
    ):
        out = await specialists._complete_ctx(
            model="m",
            model_config=None,
            ctx={"a": 1},
            shrink_order=[],
            instructions="i",
            metadata={},
            specialist="ghostwriter",
            project_id=7,
            user_id=3,
        )
    assert out == "answer"
    assert rec.call_args.kwargs["specialist"] == "ghostwriter"
    assert rec.call_args.kwargs["project_id"] == 7


@pytest.mark.asyncio
async def test_ghostwriter_injects_brief():
    from app.services.bid import specialists

    seen = {}

    async def fake_create(**kw):
        seen["content"] = kw["input_messages"][0]["content"]
        seen["instructions"] = kw["instructions"]
        return "正文"

    with patch.object(specialists, "create_response", new=fake_create):
        await specialists.call_ghostwriter(
            model="m",
            model_config=None,
            section={"id": "s1", "title": "第一章"},
            tender={},
            knowledge_base={},
            brief={"style": "专业", "wordMin": "800", "requirements": "写清楚"},
        )
    ctx = json.loads(seen["content"])
    assert ctx["writing_brief"]["requirements"] == "写清楚"
    assert "writing_brief" in seen["instructions"]


@pytest.mark.asyncio
async def test_ghostwriter_no_brief_keeps_ctx_clean():
    from app.services.bid import specialists

    seen = {}

    async def fake_create(**kw):
        seen["content"] = kw["input_messages"][0]["content"]
        return "正文"

    with patch.object(specialists, "create_response", new=fake_create):
        await specialists.call_ghostwriter(
            model="m",
            model_config=None,
            section={"id": "s1"},
            tender={},
            knowledge_base={},
        )
    assert "writing_brief" not in json.loads(seen["content"])


@pytest.mark.asyncio
async def test_call_ghostwriter_grounds_via_resolve_section_grounding():
    from unittest.mock import AsyncMock, patch

    from app.services.bid import specialists

    section = {"id": "s1", "title": "方案", "covers": ["T1", "M1"]}
    tender = {
        "scoring": [{"id": "T1", "item": "方案", "weight": 20}, {"id": "T2"}],
        "mandatory_clauses": [
            {"id": "M1", "veto": True, "text": "有效期"},
            {"id": "M2", "veto": True, "text": "无关"},
        ],
    }
    with patch.object(
        specialists, "_complete_ctx", new=AsyncMock(return_value="正文")
    ) as mock_ctx:
        await specialists.call_ghostwriter(
            model="m",
            model_config=None,
            section=section,
            tender=tender,
            knowledge_base={},
        )
    ctx = mock_ctx.await_args.kwargs["ctx"]
    assert [s["id"] for s in ctx["scoring_to_cover"]] == ["T1"]
    assert [c["id"] for c in ctx["mandatory_clauses"]] == ["M1"]  # only covered veto
