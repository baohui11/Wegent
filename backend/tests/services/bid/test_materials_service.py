# SPDX-License-Identifier: Apache-2.0
import pytest

from app.services.bid import materials_service as ms
from app.services.bid.workspace import BidWorkspace


def test_knowledge_base_roundtrip_and_validation(tmp_path):
    ws = BidWorkspace("m1", root=tmp_path)
    ms.write_knowledge_base(ws, {"bidder_knowledge_base": {"cases": [{"name": "X"}]}})
    kb = ms.read_knowledge_base(ws)
    assert kb["bidder_knowledge_base"]["cases"][0]["name"] == "X"
    with pytest.raises(ValueError):
        ms.write_knowledge_base(ws, {"wrong_top_key": {}})


def test_qualifications_roundtrip_and_validation(tmp_path):
    ws = BidWorkspace("m2", root=tmp_path)
    ms.write_qualifications(
        ws, {"company": "好大一家", "items": {"Q1": {"title": "ISO9001"}}}
    )
    q = ms.read_qualifications(ws)
    assert q["items"]["Q1"]["title"] == "ISO9001"
    with pytest.raises(ValueError):
        ms.write_qualifications(ws, {"company": "x"})  # missing items


def test_read_missing_raises(tmp_path):
    ws = BidWorkspace("m3", root=tmp_path)
    with pytest.raises(FileNotFoundError):
        ms.read_knowledge_base(ws)
