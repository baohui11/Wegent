# SPDX-License-Identifier: Apache-2.0
import pytest

from app.services.bid.workspace import BidWorkspace


def test_write_read_roundtrip(tmp_path):
    ws = BidWorkspace("proj-1", root=tmp_path)
    p = ws.write_tender_text("招标正文")
    assert p == ws.dir() / "inputs" / "final" / "tender.txt" and p.exists()
    ws.write_json("workspace/tender_parts/project.json", {"project": {"name": "X"}})
    assert ws.read_json("workspace/tender_parts/project.json")["project"]["name"] == "X"


def test_read_text_files_dir(tmp_path):
    ws = BidWorkspace("proj-2", root=tmp_path)
    (ws.dir() / "workspace" / "tender_segments").mkdir(parents=True)
    (ws.dir() / "workspace" / "tender_segments" / "seg_001.txt").write_text(
        "片段", encoding="utf-8"
    )
    assert ws.read_text_files("workspace/tender_segments") == {"seg_001.txt": "片段"}


def test_path_traversal_rejected(tmp_path):
    ws = BidWorkspace("proj-3", root=tmp_path)
    with pytest.raises(ValueError):
        ws.path("../../etc/passwd")
