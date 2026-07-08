# SPDX-License-Identifier: Apache-2.0
import pytest

from app.services.bid import outline_service as os_
from app.services.bid import outline_stage3_service as s3
from app.services.bid.workspace import BidWorkspace


def _seed_stage1(ws):
    os_.write_outline(
        ws, {"sections": [{"id": "a", "title": "第一章", "covers": []}], "volumes": []}
    )


def test_ensure_copies_from_stage1_and_is_idempotent(tmp_path):
    ws = BidWorkspace("s3-1", root=tmp_path)
    _seed_stage1(ws)
    rel = s3.ensure_stage3_outline(ws)
    assert rel == "workspace/outline_stage3.json"
    assert ws.read_json(rel)["sections"][0]["id"] == "a"
    # A subsequent edit to stage3 must survive a second ensure() (no re-copy).
    ws.write_json(
        rel, {"sections": [{"id": "a", "title": "改过", "covers": []}], "volumes": []}
    )
    s3.ensure_stage3_outline(ws)
    assert ws.read_json(rel)["sections"][0]["title"] == "改过"


def test_ensure_does_not_mutate_stage1(tmp_path):
    ws = BidWorkspace("s3-2", root=tmp_path)
    _seed_stage1(ws)
    s3.ensure_stage3_outline(ws)
    ws.write_json(
        "workspace/outline_stage3.json",
        {"sections": [{"id": "a", "title": "X"}], "volumes": []},
    )
    assert os_.read_outline(ws)["sections"][0]["title"] == "第一章"


def test_write_then_read_roundtrip_and_bad_shape(tmp_path):
    ws = BidWorkspace("s3-3", root=tmp_path)
    s3.write_stage3_outline(ws, {"sections": [{"id": "b"}], "volumes": []})
    assert s3.read_stage3_outline(ws)["sections"][0]["id"] == "b"
    with pytest.raises(ValueError):
        s3.write_stage3_outline(ws, {"no_sections": True})


def test_differs_from_stage1(tmp_path):
    ws = BidWorkspace("s3-4", root=tmp_path)
    # No stage1 outline -> nothing to differ from.
    assert s3.differs_from_stage1(ws) is False
    _seed_stage1(ws)
    # Fresh stage3 == stage1.
    assert s3.differs_from_stage1(ws) is False
    # Edit stage3 -> differs.
    s3.write_stage3_outline(
        ws, {"sections": [{"id": "a", "title": "改过"}], "volumes": []}
    )
    assert s3.differs_from_stage1(ws) is True
