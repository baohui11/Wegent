# SPDX-License-Identifier: Apache-2.0
"""Agentic drafting prompt: vendor ghostwriter prompt + opencode discipline
guardrails (read the skill, skeleton-first, incremental persist, bounded
exploration, no fabricated policy numbers) + per-section grounding. Ported from
the validated bake-off build_c_prompt; the only variable knob is explore_budget.
"""
import json
from pathlib import Path

from app.services.bid import heading_align
from app.services.bid.coverage import resolve_section_grounding

_GW = (Path(__file__).parent / "vendor" / "prompts" / "bid_ghostwriter.md").read_text(
    encoding="utf-8"
)

_GUARDRAILS = (
    "\n\n## 运行方式（bid agentic 起草 · 有护栏）\n"
    "你在工作目录里，工具 read/grep/find/ls/write/edit。\n"
    "1. **动笔前必读** `skills/bid-section-writer/SKILL.md` 与 "
    "`skills/bid-section-writer/references/style-zhongda.md`（风格圣经）。\n"
    "2. **骨架优先**：第一步先把本节骨架（小标题/要点列表）**write 进** "
    "`workspace/sections/{sid}.md`，再用 **edit** 逐块填充成文——不要憋整节再一次性写。\n"
    "3. **增量落盘**：每完成一块就 edit 落盘，不要把大段中间内容攒在对话里。\n"
    "4. **探索有界**：探查文件累计 ≤~{budget} 次后必须开始写骨架。\n"
    "5. **取真实证据**：从 `workspace/tender_normalized.json`、"
    "`corpus/bidder_knowledge_base.json`、`corpus/qualifications.json` 取；"
    "`{{qual:ID}}` 只用 qualifications.json 里的真实 ID；"
    "**严禁编造具体政策数字/百分比/机构指标**（无出处的一律写 `待填（来源：..）`）。\n"
    "完成后只回复：已写出 workspace/sections/{sid}.md"
)


def build_agentic_prompt(
    node: dict, tender: dict, brief: dict | None = None, explore_budget: int = 30
) -> str:
    g = resolve_section_grounding(node, tender)
    sid = node.get("id")
    title = node.get("title")
    parts = [
        _GW,
        _GUARDRAILS.format(sid=sid, budget=explore_budget),
        "\n## 本节任务",
        f"section_id={sid} 标题={title}",
        "必须覆盖的评分项 scoring_to_cover：\n"
        + json.dumps(g["scoring"], ensure_ascii=False, indent=2),
        "★/▲ 条款：\n" + json.dumps(g["clauses"], ensure_ascii=False, indent=2),
        "must_keep（原样写入正文句子）："
        + json.dumps(node.get("must_keep") or [], ensure_ascii=False),
    ]
    leaves = heading_align.leaf_titles(node)
    if leaves:
        parts.append(
            "\n## 小节结构（必须遵守）\n"
            "本章大纲小节标题清单：\n"
            + json.dumps(leaves, ensure_ascii=False)
            + "\n正文必须为每个小节输出一个 `##` 二级标题，标题文本逐字使用清单文本、"
            "保持顺序，每小节一个 `##`；其下撰写正文（可加更细的 `###`）。"
        )
    if brief:
        parts.append(
            "\n## 编写要求 writing_brief：\n"
            + json.dumps(brief, ensure_ascii=False, indent=2)
        )
    return "\n".join(parts)
