# SPDX-License-Identifier: Apache-2.0
import pytest

from app.services.bid import outline_service as os_
from app.services.bid.workspace import BidWorkspace


def test_write_then_read_outline(tmp_path):
    ws = BidWorkspace("o1", root=tmp_path)
    os_.write_outline(ws, {"sections": [{"id": "a", "covers": []}], "volumes": []})
    assert os_.read_outline(ws)["sections"][0]["id"] == "a"


def test_write_outline_rejects_bad_shape(tmp_path):
    ws = BidWorkspace("o2", root=tmp_path)
    with pytest.raises(ValueError):
        os_.write_outline(ws, {"no_sections": True})


def test_write_bid_config(tmp_path):
    ws = BidWorkspace("o3", root=tmp_path)
    os_.write_bid_config(ws, "包件二")
    assert ws.read_json("corpus/bid_config.json")["package"] == "包件二"
