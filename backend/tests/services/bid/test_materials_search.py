# SPDX-License-Identifier: Apache-2.0
from app.services.bid import materials_search as msearch
from app.services.bid.workspace import BidWorkspace


def _ws(tmp_path):
    return BidWorkspace("mat-search", root=tmp_path)


def _write_material(ws, name, text):
    p = ws.path(f"corpus/materials/{name}.md")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def test_read_returns_full_text(tmp_path):
    ws = _ws(tmp_path)
    _write_material(ws, "cert.txt", "公司具备一级资质，注册资本一亿元。")
    assert msearch.read(ws, "cert.txt") == "公司具备一级资质，注册资本一亿元。"


def test_read_range_returns_slice(tmp_path):
    ws = _ws(tmp_path)
    _write_material(ws, "cert.txt", "0123456789")
    assert msearch.read(ws, "cert.txt", (2, 5)) == "234"


def test_read_unknown_or_traversal_name_returns_empty(tmp_path):
    ws = _ws(tmp_path)
    _write_material(ws, "cert.txt", "x")
    assert msearch.read(ws, "missing.txt") == ""
    assert msearch.read(ws, "../../etc/passwd") == ""
