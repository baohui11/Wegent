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
