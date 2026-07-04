# SPDX-License-Identifier: Apache-2.0
"""拆标神探 over Chat, sharded per required block by route_tags."""

import json
import logging
from pathlib import Path

from app.services.chat_shell_model_service import complete_text

logger = logging.getLogger(__name__)

_PROMPT = (Path(__file__).parent / "vendor" / "prompts" / "tender_sleuth.md").read_text(
    encoding="utf-8"
)

# top-level block -> routing hints. Tags MUST come from the segmenter's real
# vocabulary: segment_tender.py emits route_tags from references/
# segment_keywords.json route_keywords (scoring / mandatory_clauses /
# required_outline / submission_rules) plus the literal "unrouted" for
# everything else. Body-like blocks route to "unrouted" (the document bulk);
# structured blocks get their focused segments. cfg["veto"]=True additionally
# includes unrouted segments (see _route_segments) and injects veto candidates.
ROUTE_MAP: dict[str, dict] = {
    "project": {"tags": ["unrouted"], "veto": False, "regions": False},
    "qualifications": {
        "tags": ["mandatory_clauses", "submission_rules"],
        "veto": True,
        "regions": False,
    },
    "target_package": {
        "tags": ["scoring", "submission_rules"],
        "veto": False,
        "regions": True,
    },
    "scoring": {"tags": ["scoring"], "veto": False, "regions": True},
    "mandatory_clauses": {
        "tags": ["mandatory_clauses"],
        "veto": True,
        "regions": False,
    },
    "submission_rules": {"tags": ["submission_rules"], "veto": False, "regions": False},
    "required_outline": {"tags": ["required_outline"], "veto": False, "regions": True},
    "requirements": {
        "tags": ["required_outline", "unrouted"],
        "veto": False,
        "regions": False,
    },
    "commitment_terms": {
        "tags": ["mandatory_clauses", "submission_rules", "unrouted"],
        "veto": False,
        "regions": False,
    },
    "derived_outline": {
        "tags": ["required_outline", "unrouted"],
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


# Prompt-size guard: chat_shell is a stateless gateway (history_limit=0), so
# per-call context size is entirely what we assemble here. Trim to a character
# budget before sending instead of letting the provider reject the call.
_MAX_PROMPT_CHARS = 200_000  # ~50k tokens at ~4 chars/token, conservative

_CTX_ERR_MARKERS = (
    "context_length",
    "context window",
    "maximum context",
    "too many tokens",
    "prompt is too long",
)


def _fit_budget(ctx: dict, order: list[str], budget: int = _MAX_PROMPT_CHARS) -> dict:
    """Trim ``ctx`` to ``budget`` serialized chars. Keys in ``order`` are
    truncated (head kept) or dropped, first key first; other keys are never
    touched."""

    def size(c: dict) -> int:
        return len(json.dumps(c, ensure_ascii=False))

    if size(ctx) <= budget:
        return ctx
    ctx = dict(ctx)
    for key in order:
        if key not in ctx:
            continue
        overshoot = size(ctx) - budget
        if overshoot <= 0:
            break
        blob = json.dumps(ctx[key], ensure_ascii=False)
        keep = len(blob) - overshoot
        if keep <= 0:
            ctx.pop(key)
        else:
            ctx[key] = blob[:keep] + "…[truncated]"
    return ctx


async def _complete_ctx(
    *,
    model: str,
    model_config: dict | None,
    ctx: dict,
    shrink_order: list[str],
    instructions: str,
    metadata: dict,
) -> str:
    """complete_text with pre-call budget trimming and one halved-budget retry
    on provider context-length errors."""
    fitted = _fit_budget(ctx, shrink_order)
    try:
        return await complete_text(
            model=model,
            model_config=model_config,
            input_messages=[
                {"role": "user", "content": json.dumps(fitted, ensure_ascii=False)}
            ],
            instructions=instructions,
            metadata=metadata,
        )
    except Exception as e:
        msg = str(e).lower()
        if not any(m in msg for m in _CTX_ERR_MARKERS):
            raise
        logger.warning("context overflow, retrying with halved budget: %s", e)
        halved = _fit_budget(ctx, shrink_order, budget=_MAX_PROMPT_CHARS // 2)
        return await complete_text(
            model=model,
            model_config=model_config,
            input_messages=[
                {"role": "user", "content": json.dumps(halved, ensure_ascii=False)}
            ],
            instructions=instructions,
            metadata=metadata,
        )


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
        raw = await _complete_ctx(
            model=model,
            model_config=model_config,
            ctx=ctx,
            shrink_order=["tender_regions", "tender_segments"],
            instructions=instructions,
            metadata={"block": block},
        )
        stripped = _strip_fence(raw)
        try:
            obj = json.loads(stripped)
        except json.JSONDecodeError:
            # A single block's malformed LLM output must not abort the whole
            # parse; skip it (merge validates REQUIRED_BLOCKS) and log the raw.
            logger.warning(
                "tender_sleuth block %s: non-JSON LLM response (%d chars): %r",
                block,
                len(raw or ""),
                (raw or "")[:400],
            )
            continue
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
    instruction: str | None = None,
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
    if instruction:
        instructions += "\n\n## 本次修改要求（优先满足）\n" + instruction
    raw = await _complete_ctx(
        model=model,
        model_config=model_config,
        ctx=ctx,
        shrink_order=["bidder_knowledge_base"],
        instructions=instructions,
        metadata={"section": section.get("id")},
    )
    return _strip_fence(raw)


_FC_PROMPT = (
    Path(__file__).parent / "vendor" / "prompts" / "fact-checker.md"
).read_text(encoding="utf-8")


async def call_fact_checker(
    *,
    model: str,
    model_config: dict | None,
    tasks: list[dict],
) -> list[dict]:
    if not tasks:
        return []
    instructions = (
        _FC_PROMPT
        + '\n\n## 后端调用输出格式\n只返回一个 JSON 对象 {"verdicts": [...]}，'
        + "不要 markdown 围栏、不要复述原文、不要解释。"
    )
    raw = await complete_text(
        model=model,
        model_config=model_config,
        input_messages=[
            {
                "role": "user",
                "content": json.dumps({"tasks": tasks}, ensure_ascii=False),
            }
        ],
        instructions=instructions,
        metadata={"stage": "fact_check", "count": len(tasks)},
    )
    obj = json.loads(_strip_fence(raw))
    if isinstance(obj, dict):
        return obj.get("verdicts", [])
    return obj if isinstance(obj, list) else []
