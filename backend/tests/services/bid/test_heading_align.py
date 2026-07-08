# SPDX-License-Identifier: Apache-2.0
from app.services.bid import heading_align as ha

_CHAPTER = {
    "id": "s1",
    "title": "第一章 总体技术方案",
    "children": [
        {"id": "s1.1", "title": "系统总体架构设计"},
        {"id": "s1.2", "title": "关键技术选型"},
    ],
}


def test_leaf_titles_collects_leaves_in_order():
    assert ha.leaf_titles(_CHAPTER) == ["系统总体架构设计", "关键技术选型"]


def test_leaf_titles_recurses_and_childless_chapter_is_empty():
    nested = {
        "children": [{"title": "组", "children": [{"title": "叶A"}, {"title": "叶B"}]}]
    }
    assert ha.leaf_titles(nested) == ["叶A", "叶B"]
    assert ha.leaf_titles({"title": "无子章"}) == []


def test_body_headings_extracts_h2_to_h6():
    md = "开头段。\n\n## 系统总体架构设计\n正文\n\n### 子块\n更多\n\n#不是标题"
    assert ha.body_headings(md) == ["系统总体架构设计", "子块"]


def test_missing_leaf_headings_exact_match():
    md = "## 系统总体架构设计\n正文"
    assert ha.missing_leaf_headings(_CHAPTER, md) == ["关键技术选型"]


def test_align_appends_placeholder_headings_for_missing():
    md = "## 系统总体架构设计\n正文"
    aligned, appended = ha.align_leaf_headings(_CHAPTER, md)
    assert appended == ["关键技术选型"]
    assert "## 关键技术选型" in aligned
    assert "待填（来源：..）" in aligned
    # Present leaf is not duplicated.
    assert aligned.count("## 系统总体架构设计") == 1


def test_align_noop_when_all_present():
    md = "## 系统总体架构设计\n正文\n\n## 关键技术选型\n正文"
    aligned, appended = ha.align_leaf_headings(_CHAPTER, md)
    assert appended == [] and aligned == md
