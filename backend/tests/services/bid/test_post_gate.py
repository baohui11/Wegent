# SPDX-License-Identifier: Apache-2.0
from app.services.bid import post_gate
from app.services.bid.workspace import BidWorkspace


def _ws(tmp_path):
    return BidWorkspace("post-gate", root=tmp_path)


def _section(ws, sid, text):
    p = ws.path(f"workspace/sections/{sid}.md")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def test_check_passes_when_all_satisfied(tmp_path):
    ws = _ws(tmp_path)
    _section(
        ws,
        "s1",
        "本公司通过 ISO9001 认证。" + "达标内容" * 50 + "\n```figure\nid: f1\n```",
    )
    node = {"id": "s1", "title": "质量", "must_keep": ["ISO9001"]}
    brief = {"wordMin": "50", "needFigure": "是"}
    res = post_gate.check_section(ws, "s1", node, brief)
    assert res["ok"] is True and res["issues"] == []


def test_check_flags_word_floor(tmp_path):
    ws = _ws(tmp_path)
    _section(ws, "s1", "太短")
    res = post_gate.check_section(ws, "s1", {"id": "s1"}, {"wordMin": "800"})
    assert res["ok"] is False
    assert any("字数" in i for i in res["issues"])


def test_check_flags_missing_must_keep(tmp_path):
    ws = _ws(tmp_path)
    _section(ws, "s1", "正文很长" * 300)
    node = {"id": "s1", "must_keep": ["必须出现的承诺X"]}
    res = post_gate.check_section(ws, "s1", node, {"wordMin": "10"})
    assert res["ok"] is False
    assert any("必写" in i or "must_keep" in i for i in res["issues"])


def test_check_flags_missing_figure_when_required(tmp_path):
    ws = _ws(tmp_path)
    _section(ws, "s1", "正文很长" * 300)  # no ```figure block
    res = post_gate.check_section(
        ws, "s1", {"id": "s1"}, {"wordMin": "10", "needFigure": "是"}
    )
    assert res["ok"] is False
    assert any("图" in i for i in res["issues"])


def test_check_missing_file_is_not_ok(tmp_path):
    ws = _ws(tmp_path)
    res = post_gate.check_section(ws, "s1", {"id": "s1"}, None)
    assert res["ok"] is False


def test_check_no_applicable_rules_is_ok(tmp_path):
    ws = _ws(tmp_path)
    _section(ws, "s1", "任意正文")
    # no brief -> no word/figure rule; no must_keep -> nothing to enforce
    assert post_gate.check_section(ws, "s1", {"id": "s1"}, None)["ok"] is True


def test_rework_instruction_and_issue_roundtrip(tmp_path):
    ws = _ws(tmp_path)
    instr = post_gate.rework_instruction(
        ["字数 20 少于要求 800", "缺少必写内容：承诺X"]
    )
    assert "800" in instr and "承诺X" in instr
    post_gate.record_issues(ws, "s1", ["字数不足"])
    assert post_gate.read_issues(ws)["s1"] == ["字数不足"]


def test_check_section_flags_missing_leaf_heading(tmp_path):
    from app.services.bid import drafting_service as ds
    from app.services.bid import post_gate
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("pg-leaf", root=tmp_path)
    node = {
        "id": "s1",
        "title": "第一章",
        "children": [{"title": "小节甲"}, {"title": "小节乙"}],
    }
    # Body has 甲 but not 乙.
    ds.write_section(ws, "s1", "## 小节甲\n正文足够长。")
    res = post_gate.check_section(ws, "s1", node, brief=None)
    assert res["ok"] is False
    assert any("小节乙" in i for i in res["issues"])
    assert not any("小节甲" in i for i in res["issues"])
