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
        "paused": False,
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


def test_pause_flag_roundtrip(tmp_path):
    ws = BidWorkspace("pz1", root=tmp_path)
    ds.init_status(ws, ["s1"])
    assert ds.is_paused(ws) is False
    assert ds.read_status(ws)["paused"] is False
    ds.set_paused(ws, True)
    assert ds.is_paused(ws) is True
    ds.set_paused(ws, False)
    assert ds.is_paused(ws) is False


def test_mark_finished_clears_paused(tmp_path):
    ws = BidWorkspace("pz2", root=tmp_path)
    ds.init_status(ws, ["s1"])
    ds.set_paused(ws, True)
    ds.mark_finished(ws)
    st = ds.read_status(ws)
    assert st["finished"] is True and st["paused"] is False


def test_read_status_default_includes_paused(tmp_path):
    st = ds.read_status(BidWorkspace("pz3", root=tmp_path))
    assert st["paused"] is False
