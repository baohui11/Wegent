# SPDX-License-Identifier: Apache-2.0
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid import draft_pipeline as dp
from app.services.bid import drafting_service as ds
from app.services.bid.workspace import BidWorkspace


def _ws(tmp_path) -> BidWorkspace:
    return BidWorkspace("redraft-range-1", root=tmp_path)


@pytest.mark.asyncio
async def test_redraft_range_splices_only_target_lines(tmp_path):
    ws = _ws(tmp_path)
    ds.write_section(ws, "s1", "第一段。\n第二段。\n第三段。")
    with patch(
        "app.services.bid.draft_pipeline.rewrite_excerpt",
        new=AsyncMock(return_value="改写后的第二段。"),
    ):
        await dp.redraft_range(
            ws,
            "s1",
            start_line=2,
            end_line=2,
            instruction="更凝练",
            model="m",
            model_config=None,
        )
    assert ds.read_section(ws, "s1") == "第一段。\n改写后的第二段。\n第三段。"
    assert ds.read_status(ws)["sections"]["s1"] == "done"


@pytest.mark.asyncio
async def test_redraft_range_multiline_excerpt(tmp_path):
    ws = _ws(tmp_path)
    ds.write_section(ws, "s1", "A\nB\nC\nD")
    with patch(
        "app.services.bid.draft_pipeline.rewrite_excerpt",
        new=AsyncMock(return_value="X\nY"),
    ):
        await dp.redraft_range(
            ws,
            "s1",
            start_line=2,
            end_line=3,
            instruction=None,
            model="m",
            model_config=None,
        )
    assert ds.read_section(ws, "s1") == "A\nX\nY\nD"
