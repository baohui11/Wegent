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


def test_delete_section_removes_md_status_key_and_decrements_total(tmp_path):
    from app.services.bid import drafting_service as ds
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("del-1", root=tmp_path)
    ds.init_status(ws, ["s1", "s2"])
    ds.write_section(ws, "s1", "正文一")
    ds.delete_section(ws, "s1")
    st = ds.read_status(ws)
    assert "s1" not in st["sections"] and st["total"] == 1
    assert not ws.path("workspace/sections/s1.md").exists()
    # Idempotent: deleting an unknown section is a no-op.
    ds.delete_section(ws, "nope")
    assert ds.read_status(ws)["total"] == 1


def test_add_section_appends_pending_and_bumps_total_once(tmp_path):
    from app.services.bid import drafting_service as ds
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("add-1", root=tmp_path)
    ds.init_status(ws, ["s1"])
    ds.add_section(ws, "s2")
    st = ds.read_status(ws)
    assert st["sections"]["s2"] == "pending" and st["total"] == 2
    ds.add_section(ws, "s2")  # idempotent
    assert ds.read_status(ws)["total"] == 2
