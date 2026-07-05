# SPDX-License-Identifier: Apache-2.0
from app.services.bid import materials_service
from app.services.bid import section_retrieval as sr
from app.services.bid.workspace import BidWorkspace


def _ws(tmp_path):
    return BidWorkspace("sec-retr", root=tmp_path)


def _material(ws, name, text):
    p = ws.path(f"corpus/materials/{name}.md")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def _link(ws, entries):
    materials_service.write_briefs(ws, {"briefs": {}, "materials": entries})


def test_retrieve_returns_relevant_snippet_scoped(tmp_path):
    ws = _ws(tmp_path)
    _material(ws, "quality.md", "本公司通过 ISO9001 质量管理体系认证，制度健全。")
    _material(ws, "safety.md", "安全生产责任制度与应急预案完善。")
    _link(
        ws,
        [
            {
                "id": "1",
                "name": "quality.md",
                "linkedNodeIds": ["s1"],
                "scope": "linked",
            },
            {
                "id": "2",
                "name": "safety.md",
                "linkedNodeIds": ["s2"],
                "scope": "linked",
            },
        ],
    )
    node = {"id": "s1", "title": "质量管理体系"}
    got = sr.retrieve_for_section(ws, node, {"importance": "中"})
    names = [m["name"] for m in got]
    assert "quality.md" in names  # matched + visible to s1
    assert "safety.md" not in names  # scoped to s2 only
    assert got[0]["summary"]  # snippet present
    assert got[0]["scope"] == "linked"


def test_retrieve_importance_budget_caps_count(tmp_path):
    ws = _ws(tmp_path)
    # 4 materials < 4b's per-query _MAX_HITS=5, so one query surfaces all 4 and
    # the ONLY cap in play is the importance budget (isolates the behavior).
    entries = []
    for i in range(4):
        _material(ws, f"m{i}.md", "质量管理体系 相关材料片段。")
        entries.append(
            {"id": str(i), "name": f"m{i}.md", "linkedNodeIds": [], "scope": "global"}
        )
    _link(ws, entries)
    node = {"id": "s1", "title": "质量管理体系"}
    low = sr.retrieve_for_section(ws, node, {"importance": "低"})  # budget 3
    high = sr.retrieve_for_section(ws, node, {"importance": "高"})  # budget 8
    assert len(low) == 3  # capped by budget
    assert len(high) == 4  # all 4 matches, under cap 8


def test_retrieve_falls_back_to_scope_summaries_when_no_hit(tmp_path):
    ws = _ws(tmp_path)
    _material(ws, "corp.md", "公司简介与发展历程。")
    _link(
        ws, [{"id": "1", "name": "corp.md", "linkedNodeIds": ["s1"], "scope": "linked"}]
    )
    node = {"id": "s1", "title": "无关主题ZZZ"}  # no query term matches corp.md
    got = sr.retrieve_for_section(ws, node, {"importance": "中"})
    assert [m["name"] for m in got] == ["corp.md"]  # fallback to materials_for
    assert got[0]["summary"].startswith("公司简介")  # 800-char summary, not a snippet


def test_retrieve_never_raises_on_empty(tmp_path):
    ws = _ws(tmp_path)
    assert sr.retrieve_for_section(ws, {"id": "s1", "title": ""}, None) == []
