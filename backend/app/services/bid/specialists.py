# SPDX-License-Identifier: Apache-2.0
"""拆标神探 over Chat, sharded per required block by route_tags."""

import json
import logging
import time
from pathlib import Path

from app.services.bid import llm_log, materials_service
from app.services.chat_shell_model_service import (
    create_response,
    extract_response_text,
)

logger = logging.getLogger(__name__)

# OTel span per specialist call. shared.telemetry may be unavailable in some
# test environments; fall back to a no-op decorator so the pipeline never breaks.
try:
    from shared.telemetry.decorators import trace_async
except Exception:  # pragma: no cover - import guard for stripped-down envs

    def trace_async(*_a, **_kw):  # type: ignore[misc]
        def deco(func):
            return func

        return deco


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


def extract_usage(response) -> tuple[int, int]:
    """Best-effort (prompt_tokens, completion_tokens) from a chat_shell response.

    bid responses arrive as an SSE string; token counts live in
    ``response.status.updated`` context_metrics (used_input_tokens) and the
    ``response.completed`` usage block. Returns (0, 0) if unparseable.
    """
    prompt_toks = 0
    completion_toks = 0
    text = response if isinstance(response, str) else ""
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        try:
            ev = json.loads(line[len("data:") :].strip())
        except json.JSONDecodeError:
            continue
        cm = ev.get("context_metrics") if isinstance(ev, dict) else None
        if isinstance(cm, dict) and cm.get("used_input_tokens"):
            prompt_toks = int(cm["used_input_tokens"])
        usage = (
            (ev.get("response") or {}).get("usage") if isinstance(ev, dict) else None
        )
        if isinstance(usage, dict):
            prompt_toks = int(usage.get("input_tokens") or prompt_toks)
            completion_toks = int(usage.get("output_tokens") or completion_toks)
    return prompt_toks, completion_toks


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


@trace_async(
    span_name="bid.specialist_call",
    tracer_name="bid.specialists",
    extract_attributes=lambda *a, **kw: {
        "bid.specialist": kw.get("specialist", ""),
        "bid.project_id": str(kw.get("project_id") or ""),
        "bid.model": str(kw.get("model") or ""),
    },
)
async def _complete_ctx(
    *,
    model: str,
    model_config: dict | None,
    ctx: dict,
    shrink_order: list[str],
    instructions: str,
    metadata: dict,
    specialist: str,
    label: str = "",
    project_id: int | None,
    user_id: int | None,
) -> str:
    """create_response with pre-call budget trimming and one halved-budget retry
    on provider context-length errors. Single chokepoint for LLM call logging:
    records usage (tokens) + duration + status to bid_llm_calls."""
    fitted = _fit_budget(ctx, shrink_order)
    payload = json.dumps(fitted, ensure_ascii=False)
    start = time.monotonic()
    status, error, resp, text = "ok", None, None, ""
    try:
        try:
            resp = await create_response(
                model=model,
                model_config=model_config,
                input_messages=[{"role": "user", "content": payload}],
                instructions=instructions,
                metadata=metadata,
                stream=False,
            )
        except Exception as e:
            msg = str(e).lower()
            if not any(m in msg for m in _CTX_ERR_MARKERS):
                raise
            logger.warning("context overflow, retrying with halved budget: %s", e)
            halved = json.dumps(
                _fit_budget(ctx, shrink_order, budget=_MAX_PROMPT_CHARS // 2),
                ensure_ascii=False,
            )
            payload = halved
            resp = await create_response(
                model=model,
                model_config=model_config,
                input_messages=[{"role": "user", "content": halved}],
                instructions=instructions,
                metadata=metadata,
                stream=False,
            )
        text = extract_response_text(resp)
        return text
    except Exception as e:
        status, error = "error", str(e)
        raise
    finally:
        pt, ct = extract_usage(resp) if resp is not None else (0, 0)
        llm_log.record(
            project_id=project_id,
            user_id=user_id,
            specialist=specialist,
            label=label,
            model=model,
            request=instructions + "\n\n" + payload,
            response=text if status == "ok" else "",
            prompt_tokens=pt,
            completion_tokens=ct,
            duration_ms=int((time.monotonic() - start) * 1000),
            status=status,
            error=error,
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
    project_id: int | None = None,
    user_id: int | None = None,
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
            specialist="tender_sleuth",
            label=block,
            project_id=project_id,
            user_id=user_id,
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
    brief: dict | None = None,
    style_card: str | None = None,
    project_id: int | None = None,
    user_id: int | None = None,
) -> str:
    from app.services.bid.coverage import resolve_section_grounding

    grounding = resolve_section_grounding(section, tender)
    scoring = grounding["scoring"]
    clauses = grounding["clauses"]
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
    if brief:
        ctx["writing_brief"] = brief
    instructions = (
        _GW_PROMPT
        + "\n\n## 风格圣经（style-zhongda.md）\n"
        + _STYLE
        + "\n\n## 后端调用输出格式\n只返回本节正文 markdown，不要 JSON、不要代码围栏。"
    )
    if brief:
        instructions += (
            "\n\n## 本节人工编写要求（writing_brief，必须遵守）\n"
            "输入 JSON 中的 writing_brief 是用户在素材阶段为本节填写的编写要求"
            f"（{materials_service.NODE_BRIEF_FIELDS_ZH}）。"
            "正文必须遵守这些要求；如与评分项覆盖冲突，以覆盖评分项为先。"
        )
    if style_card:
        instructions += "\n\n## 项目一致性（全局，必须遵守）\n" + style_card
    if instruction:
        instructions += "\n\n## 本次修改要求（优先满足）\n" + instruction
    raw = await _complete_ctx(
        model=model,
        model_config=model_config,
        ctx=ctx,
        shrink_order=["bidder_knowledge_base"],
        instructions=instructions,
        metadata={"section": section.get("id")},
        specialist="ghostwriter",
        label=str(section.get("title") or section.get("id") or ""),
        project_id=project_id,
        user_id=user_id,
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
    project_id: int | None = None,
    user_id: int | None = None,
) -> list[dict]:
    if not tasks:
        return []
    instructions = (
        _FC_PROMPT
        + '\n\n## 后端调用输出格式\n只返回一个 JSON 对象 {"verdicts": [...]}，'
        + "不要 markdown 围栏、不要复述原文、不要解释。"
    )
    raw = await _complete_ctx(
        model=model,
        model_config=model_config,
        ctx={"tasks": tasks},
        shrink_order=["tasks"],
        instructions=instructions,
        metadata={"stage": "fact_check", "count": len(tasks)},
        specialist="fact_checker",
        project_id=project_id,
        user_id=user_id,
    )
    obj = json.loads(_strip_fence(raw))
    if isinstance(obj, dict):
        return obj.get("verdicts", [])
    return obj if isinstance(obj, list) else []


_BRIEF_PROMPT = (
    "你是标书规划助理。给定若干章节的结构化信息（标题、要覆盖的评分项 scoring_to_cover、"
    "★否决条款 mandatory_clauses、已链接材料 materials、字数档 word_floor、重要性 importance），"
    "为每节生成一段**面向枪手的编写要求**。只依据所给信息，不得自造招标义务、不得虚构材料，"
    "**不得在文字里回显评分/条款 ID**（如「针对评分项 S3」「R019」）。requirements 用 3-6 条中文要点，"
    "说清本节要论证什么、覆盖哪些得分锚点（用人话不用 ID）、用哪些材料、可核验数字缺则标『待填(来源:..)』；"
    "emphasis 一句话点明本节最该突出的差异化亮点。"
)


async def call_brief_writer(
    *,
    model: str,
    model_config: dict | None,
    nodes_ctx: list[dict],
    project_id: int | None = None,
    user_id: int | None = None,
) -> dict[str, dict]:
    """Generate per-section writing briefs from code-assembled node context.
    Returns {node_id: {"requirements": str, "emphasis": str}}. Deterministic
    fields (word floors / importance / needFigure) are NOT set here."""
    ctx = {"nodes": nodes_ctx}
    instructions = (
        _BRIEF_PROMPT
        + '\n\n只返回严格 JSON：{"briefs": {"<node_id>": '
        + '{"requirements": "...", "emphasis": "..."}}}，不要多余文字、不要代码围栏外内容。'
    )
    raw = await _complete_ctx(
        model=model,
        model_config=model_config,
        ctx=ctx,
        shrink_order=["nodes"],
        instructions=instructions,
        metadata={},
        specialist="brief_writer",
        label=f"{len(nodes_ctx)} nodes",
        project_id=project_id,
        user_id=user_id,
    )
    data = json.loads(_strip_fence(raw))
    briefs = data.get("briefs", {})
    return {
        str(k): {
            "requirements": str(v.get("requirements") or "").strip(),
            "emphasis": str(v.get("emphasis") or "").strip(),
        }
        for k, v in briefs.items()
        if isinstance(v, dict)
    }
