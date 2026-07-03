# SPDX-License-Identifier: Apache-2.0
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid.specialists import ROUTE_MAP, call_tender_sleuth


@pytest.mark.asyncio
async def test_calls_once_per_block_and_keys_by_toplevel(monkeypatch):
    # Each block returns a {top-level key: {...}} JSON.
    async def fake_complete(**kwargs):
        block = kwargs["metadata"]["block"]
        return json.dumps({block: {"ok": True}}, ensure_ascii=False)

    with patch(
        "app.services.bid.specialists.complete_text",
        new=AsyncMock(side_effect=fake_complete),
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
        "app.services.bid.specialists.complete_text",
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
        "app.services.bid.specialists.complete_text",
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
        "app.services.bid.specialists.complete_text",
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
        "app.services.bid.specialists.complete_text",
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
