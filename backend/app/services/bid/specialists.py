# SPDX-License-Identifier: Apache-2.0
"""拆标神探 over Chat, sharded per required block by route_tags."""

import json
from pathlib import Path

from app.services.chat_shell_model_service import complete_text

_PROMPT = (Path(__file__).parent / "vendor" / "prompts" / "tender_sleuth.md").read_text(
    encoding="utf-8"
)

# top-level block -> routing hints. route_tag names calibrated against vendor
# segment_tender.py output (references/segment_keywords.json route_keywords).
ROUTE_MAP: dict[str, dict] = {
    "project": {"tags": ["project", "notice"], "veto": False, "regions": False},
    "qualifications": {"tags": ["qualification"], "veto": True, "regions": False},
    "target_package": {"tags": ["scoring", "price"], "veto": False, "regions": True},
    "scoring": {"tags": ["scoring"], "veto": False, "regions": True},
    "mandatory_clauses": {"tags": ["clause", "veto"], "veto": True, "regions": False},
    "submission_rules": {
        "tags": ["submission", "format"],
        "veto": False,
        "regions": False,
    },
    "required_outline": {"tags": ["outline", "toc"], "veto": False, "regions": True},
    "requirements": {"tags": ["requirement", "spec"], "veto": False, "regions": False},
    "commitment_terms": {
        "tags": ["commitment", "contract"],
        "veto": False,
        "regions": False,
    },
    "derived_outline": {
        "tags": ["spec", "requirement"],
        "veto": False,
        "regions": True,
    },
}


def _strip_fence(t: str) -> str:
    t = t.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    return t.strip()


def _route_segments(
    manifest: dict, segments: dict[str, str], tags: list[str], include_unrouted: bool
) -> dict[str, str]:
    by_file = {
        s.get("file"): set(s.get("route_tags") or [])
        for s in manifest.get("segments", [])
    }
    picked = {}
    for name, content in segments.items():
        st = by_file.get(name, set())
        if st & set(tags) or (include_unrouted and (not st or "unrouted" in st)):
            picked[name] = content
    return (
        picked or segments
    )  # Conservative fallback: feed all when routing info missing.


async def call_tender_sleuth(
    *,
    model: str,
    model_config: dict | None,
    manifest: dict,
    segments: dict[str, str],
    regions: dict[str, str],
    veto: dict,
    bid_config: dict,
) -> dict[str, dict]:
    parts: dict[str, dict] = {}
    for block, cfg in ROUTE_MAP.items():
        ctx = {
            "target_block": block,
            "tender_segments": _route_segments(
                manifest, segments, cfg["tags"], cfg["veto"]
            ),
            "bid_config": bid_config,
        }
        if cfg["regions"]:
            ctx["tender_regions"] = regions
        if cfg["veto"]:
            ctx["veto_candidates"] = veto
        instructions = (
            _PROMPT + f"\n\n## 后端调用输出格式（覆盖原「write 文件」约定）\n"
            f"本次只抽取块 `{block}`。不要写文件、不要 markdown 围栏。"
            f"只返回一个 JSON 对象，顶层键为 `{block}`，值为该块内容。"
        )
        raw = await complete_text(
            model=model,
            model_config=model_config,
            input_messages=[
                {"role": "user", "content": json.dumps(ctx, ensure_ascii=False)}
            ],
            instructions=instructions,
            metadata={"block": block},
        )
        obj = json.loads(_strip_fence(raw))
        if block in obj:
            parts[block] = obj[block]
    return parts


_GW_PROMPT = (
    Path(__file__).parent / "vendor" / "prompts" / "bid_ghostwriter.md"
).read_text(encoding="utf-8")
_STYLE = (
    Path(__file__).parent
    / "vendor"
    / "skills"
    / "bid-section-writer"
    / "references"
    / "style-zhongda.md"
).read_text(encoding="utf-8")


async def call_ghostwriter(
    *,
    model: str,
    model_config: dict | None,
    section: dict,
    tender: dict,
    knowledge_base: dict,
) -> str:
    covers = set(section.get("covers") or [])
    scoring = [s for s in tender.get("scoring", []) or [] if str(s.get("id")) in covers]
    clauses = [
        c
        for c in tender.get("mandatory_clauses", []) or []
        if c.get("veto") and str(c.get("id")) in covers
    ]
    ctx = {
        "section": {
            "id": section.get("id"),
            "title": section.get("title"),
            "must_keep": section.get("must_keep") or [],
        },
        "scoring_to_cover": scoring,
        "mandatory_clauses": clauses,
        "bidder_knowledge_base": knowledge_base.get("bidder_knowledge_base", {}),
    }
    instructions = (
        _GW_PROMPT
        + "\n\n## 风格圣经（style-zhongda.md）\n"
        + _STYLE
        + "\n\n## 后端调用输出格式\n只返回本节正文 markdown，不要 JSON、不要代码围栏。"
    )
    raw = await complete_text(
        model=model,
        model_config=model_config,
        input_messages=[
            {"role": "user", "content": json.dumps(ctx, ensure_ascii=False)}
        ],
        instructions=instructions,
        metadata={"section": section.get("id")},
    )
    return _strip_fence(raw)
