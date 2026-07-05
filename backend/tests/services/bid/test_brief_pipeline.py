# SPDX-License-Identifier: Apache-2.0
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid import brief_pipeline as bp
from app.services.bid.workspace import BidWorkspace


@pytest.mark.asyncio
async def test_generate_briefs_merges_llm_and_deterministic_fields(tmp_path):
    ws = BidWorkspace("brief-gen", root=tmp_path)
    ws.write_json(
        "workspace/tender.json",
        {
            "scoring": [{"id": "T1", "weight": 20}],
            "mandatory_clauses": [{"id": "M1", "veto": True}],
        },
    )
    ws.write_json(
        "workspace/outline.json",
        {"sections": [{"id": "s1", "title": "方案", "covers": ["T1", "M1"]}]},
    )

    async def fake_writer(**kw):
        return {"s1": {"requirements": "写详细", "emphasis": "亮点A"}}

    with patch.object(bp, "call_brief_writer", new=AsyncMock(side_effect=fake_writer)):
        out = await bp.generate_briefs(
            ws, model="m", model_config=None, node_ids=["s1"]
        )

    b = out["s1"]
    assert b["requirements"] == "写详细" and b["emphasis"] == "亮点A"
    # deterministic fields computed by code, not the LLM
    assert b["importance"] == "高"  # covers a veto clause
    assert b["wordMin"] and b["wordMax"]
    assert b["needFigure"] in ("是", "否")


def test_brief_status_roundtrip(tmp_path):
    from app.services.bid import brief_pipeline as bp
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("brief-status", root=tmp_path)
    bp.init_brief_status(ws, ["s1", "s2"])
    st = bp.read_brief_status(ws)
    assert st["total"] == 2 and st["nodes"] == {"s1": "pending", "s2": "pending"}
    assert st["finished"] is False

    bp.set_brief_node_status(ws, "s1", "done")
    bp.mark_brief_finished(ws)
    st = bp.read_brief_status(ws)
    assert st["nodes"]["s1"] == "done" and st["finished"] is True
