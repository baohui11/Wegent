# SPDX-License-Identifier: Apache-2.0
import hashlib

from app.services.bid import drafting_service as ds
from app.services.bid import review_service as rv
from app.services.bid.workspace import BidWorkspace


def _ws(tmp_path) -> BidWorkspace:
    return BidWorkspace("save-1", root=tmp_path)


def test_section_version_is_sha256_of_bytes(tmp_path):
    ws = _ws(tmp_path)
    ds.write_section(ws, "s1", "正文内容")
    expected = hashlib.sha256("正文内容".encode("utf-8")).hexdigest()
    assert ds.section_version(ws, "s1") == expected


def test_section_version_empty_when_missing(tmp_path):
    assert ds.section_version(_ws(tmp_path), "nope") == ""


def test_write_section_roundtrips(tmp_path):
    ws = _ws(tmp_path)
    ds.write_section(ws, "s1", "# 标题\n\n段落")
    assert ds.read_section(ws, "s1") == "# 标题\n\n段落"


def test_clear_accepted_removes_flag(tmp_path):
    ws = _ws(tmp_path)
    rv.mark_accepted(ws, "s1")
    assert rv.read_review(ws)["accepted"].get("s1") is True
    rv.clear_accepted(ws, "s1")
    assert rv.read_review(ws)["accepted"].get("s1") in (None, False)
