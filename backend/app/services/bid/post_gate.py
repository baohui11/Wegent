# SPDX-License-Identifier: Apache-2.0
"""Phase-5 per-section deterministic post-draft gate. After a section is written,
run reliable, reproducible checks (word floor / must_keep phrases / figure block
when required) — the things a prompt alone can't guarantee. Failures drive one
auto-retry (issues fed back to the ghostwriter) and, if still failing, a
needs_rework status for manual review. No semantic 'coverage' guessing here."""

import re

from app.services.bid.workspace import BidWorkspace

_GATE_ISSUES = "workspace/_gate_issues.json"
_FIGURE_MARKER = "```figure"


def _char_count(text: str) -> int:
    # Count non-whitespace characters as a proxy for 字数 (CJK has no spaces).
    return len(re.sub(r"\s", "", text))


def _section_text(ws: BidWorkspace, section_id: str) -> str | None:
    p = ws.path(f"workspace/sections/{section_id}.md")
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8")


def check_section(
    ws: BidWorkspace, section_id: str, node: dict, brief: dict | None
) -> dict:
    """Deterministic gate for one drafted section. Returns {ok, issues}."""
    text = _section_text(ws, section_id)
    if text is None or not text.strip():
        return {"ok": False, "issues": ["正文缺失或为空"]}

    issues: list[str] = []
    brief = brief or {}

    # 1. Word floor (check_style): thin drafts lose points (vendor prompt: 篇幅是硬要求).
    try:
        word_min = int(str(brief.get("wordMin") or "0"))
    except ValueError:
        word_min = 0
    if word_min > 0:
        n = _char_count(text)
        if n < word_min:
            issues.append(f"字数 {n} 少于要求 {word_min}")

    # 2. must_keep phrases must appear verbatim.
    for phrase in node.get("must_keep") or []:
        p = str(phrase).strip()
        if p and p not in text:
            issues.append(f"缺少必写内容（must_keep）：{p}")

    # 3. Figure required but no ```figure spec block present.
    if brief.get("needFigure") == "是" and _FIGURE_MARKER not in text:
        issues.append("本节要求配图，但正文无 ```figure 规格块")

    return {"ok": not issues, "issues": issues}


def rework_instruction(issues: list[str]) -> str:
    """Turn gate issues into a correction instruction fed back to the ghostwriter."""
    return (
        "上一稿未通过确定性质检，请在保持覆盖与合规的前提下修正以下问题后重写本节：\n- "
        + "\n- ".join(issues)
    )


def record_issues(ws: BidWorkspace, section_id: str, issues: list[str]) -> None:
    doc = read_issues(ws)
    doc[str(section_id)] = issues
    ws.write_json(_GATE_ISSUES, doc)


def read_issues(ws: BidWorkspace) -> dict:
    if not ws.path(_GATE_ISSUES).exists():
        return {}
    return ws.read_json(_GATE_ISSUES)
