# SPDX-License-Identifier: Apache-2.0
import pytest

from app.services.bid import drafting_service as ds
from app.services.bid.workspace import BidWorkspace


def test_status_lifecycle(tmp_path):
    ws = BidWorkspace("d1", root=tmp_path)
    assert ds.read_status(ws) == {
        "total": 0,
        "sections": {},
        "finished": False,
        "error": None,
    }
    ds.init_status(ws, ["a", "b"])
    st = ds.read_status(ws)
    assert st["total"] == 2 and st["sections"] == {"a": "pending", "b": "pending"}
    ds.set_section_status(ws, "a", "done")
    assert ds.read_status(ws)["sections"]["a"] == "done"
    ds.mark_finished(ws)
    assert ds.read_status(ws)["finished"] is True


def test_section_read_and_list(tmp_path):
    ws = BidWorkspace("d2", root=tmp_path)
    ws.path("workspace/sections").mkdir(parents=True)
    ws.path("workspace/sections/s1.md").write_text("正文", encoding="utf-8")
    assert ds.list_section_files(ws) == ["s1"]
    assert ds.read_section(ws, "s1") == "正文"
    with pytest.raises(FileNotFoundError):
        ds.read_section(ws, "nope")
