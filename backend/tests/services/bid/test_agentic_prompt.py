# SPDX-License-Identifier: Apache-2.0
"""Agentic drafting prompt builder tests (Phase 2).

Ports the validated bake-off build_c_prompt: vendor ghostwriter prompt + opencode
discipline guardrails (read the skill, skeleton-first, incremental persist, bounded
exploration, no fabricated policy numbers) + per-section grounding."""

from app.services.bid.agentic_prompt import build_agentic_prompt

_TENDER = {"scoring": [], "clauses": [], "sections": []}


def test_prompt_has_guardrails_grounding_and_mustkeep():
    node = {
        "id": "tech-understanding",
        "title": "对项目的理解",
        "must_keep": ["科改政策分析与宣贯"],
    }
    p = build_agentic_prompt(node, _TENDER, explore_budget=100)
    # opencode discipline guardrails
    assert "skills/bid-section-writer/SKILL.md" in p
    assert "骨架优先" in p
    assert "≤~100" in p  # explore budget threaded
    assert "workspace/sections/tech-understanding.md" in p
    # grounding + must_keep injected
    assert "must_keep" in p
    assert "科改政策分析与宣贯" in p
    # anti-fabrication
    assert "待填（来源：..）" in p


def test_prompt_includes_writing_brief_when_provided():
    node = {"id": "s1", "title": "T"}
    brief = {"requirements": "覆盖 A 与 B", "wordMin": "1500"}
    p = build_agentic_prompt(node, _TENDER, brief=brief)
    assert "writing_brief" in p
    assert "覆盖 A 与 B" in p
    assert "1500" in p


def test_prompt_omits_brief_when_none():
    node = {"id": "s1", "title": "T"}
    p = build_agentic_prompt(node, _TENDER, brief=None)
    assert "writing_brief" not in p


def test_prompt_threads_default_explore_budget():
    node = {"id": "s1", "title": "T"}
    p = build_agentic_prompt(node, _TENDER)  # default explore_budget=30
    assert "≤~30" in p


def test_agentic_prompt_lists_leaf_headings():
    node = {
        "id": "s1",
        "title": "第一章",
        "children": [{"title": "小节甲"}, {"title": "小节乙"}],
    }
    p = build_agentic_prompt(node, {"scoring": [], "mandatory_clauses": []})
    assert "小节甲" in p and "小节乙" in p
    assert "##" in p
