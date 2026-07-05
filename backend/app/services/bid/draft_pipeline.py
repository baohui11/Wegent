# SPDX-License-Identifier: Apache-2.0
"""Phase 4 (起草) orchestration.

Initial full drafting runs as a backend-orchestrated parallel fan-out: one
stateless ``call_ghostwriter`` per outline section, importance-ordered and
concurrency-capped. Single-section redraft reuses the same ``call_ghostwriter``
with an extra instruction."""

import asyncio
import logging

from app.services.bid import drafting_service as ds
from app.services.bid import materials_service, post_gate, section_retrieval
from app.services.bid.parse_pipeline import BidPipelineError
from app.services.bid.project_service import BidProjectService
from app.services.bid.specialists import call_ghostwriter
from app.services.bid.tender_normalize import ensure_normalized_tender
from app.services.bid.workspace import BidWorkspace

logger = logging.getLogger(__name__)

# Project-wide consistency directive injected into every parallel ghostwriter
# call so independently-drafted sections don't diverge on terminology / promise
# numbers / identity (mitigates the main risk of parallel drafting).
_STYLE_CARD = (
    "全篇一致性：术语、方法论命名、承诺数值前后必须统一，各章节不得各自另起名目。\n"
    "投标人身份一律用占位符 {{bidder}}，资质引用用 {{qual:ID}}；正文绝不直接写公司名/证书号。"
)

# Max concurrent section drafts in the parallel fan-out (one call_ghostwriter
# per section). Capped to bound LLM concurrency and per-run cost.
_DRAFT_CONCURRENCY = 4


def flatten_sections(outline: dict) -> list[dict]:
    out: list[dict] = []

    def walk(nodes):
        for n in nodes or []:
            if n.get("id") is not None:
                out.append(n)
            walk(n.get("children"))

    walk(outline.get("sections"))
    return out


def find_section(outline: dict, section_id: str) -> dict | None:
    for s in flatten_sections(outline):
        if str(s.get("id")) == str(section_id):
            return s
    return None


def _section_importance_key(node: dict, tender_norm: dict) -> tuple[int, float]:
    """Draft-order key: sections covering a veto clause first, then by
    descending covered-scoring weight. Ordering only — never gates coverage."""
    from app.services.bid.coverage import resolve_section_grounding

    g = resolve_section_grounding(node, tender_norm)
    has_veto = any(c.get("veto") for c in g["clauses"])
    weight = sum(float(s.get("weight") or 0) for s in g["scoring"])
    return (0 if has_veto else 1, -weight)


async def _write_and_check(
    ws,
    node,
    sid,
    *,
    brief,
    tender,
    kb,
    model,
    model_config,
    project_id,
    user_id,
    instruction,
):
    md = await call_ghostwriter(
        model=model,
        model_config=model_config,
        section=node,
        tender=tender,
        knowledge_base=kb,
        brief=brief,
        style_card=_STYLE_CARD,
        materials=section_retrieval.retrieve_for_section(ws, node, brief),
        instruction=instruction,
        project_id=project_id,
        user_id=user_id,
    )
    target = ws.path(f"workspace/sections/{sid}.md")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(md, encoding="utf-8")
    return post_gate.check_section(ws, sid, node, brief)


async def _draft_section(
    sem: asyncio.Semaphore,
    ws: BidWorkspace,
    node: dict,
    *,
    tender: dict,
    kb: dict,
    model: str,
    model_config: dict | None,
    project_id: int,
    user_id: int,
) -> None:
    sid = str(node["id"])
    async with sem:
        ds.set_section_status(ws, sid, "drafting")
        try:
            brief = materials_service.read_briefs(ws).get("briefs", {}).get(sid)
            kw = dict(
                brief=brief,
                tender=tender,
                kb=kb,
                model=model,
                model_config=model_config,
                project_id=project_id,
                user_id=user_id,
            )
            result = await _write_and_check(ws, node, sid, instruction=None, **kw)
            if not result["ok"]:
                # one deterministic-guided auto-retry
                result = await _write_and_check(
                    ws,
                    node,
                    sid,
                    instruction=post_gate.rework_instruction(result["issues"]),
                    **kw,
                )
            if result["ok"]:
                ds.set_section_status(ws, sid, "done")
            else:
                post_gate.record_issues(ws, sid, result["issues"])
                ds.set_section_status(ws, sid, "needs_rework")
        except Exception as e:  # isolate per-section failure
            logger.warning("draft section %s failed: %s", sid, e)
            ds.set_section_status(ws, sid, "error")


async def run_drafting_parallel(
    *,
    ws: BidWorkspace,
    outline: dict,
    model: str,
    model_config: dict | None,
    project_id: int,
    user_id: int,
) -> None:
    """Draft every outline section in parallel — one stateless call_ghostwriter
    per section, importance-ordered, capped at ``_DRAFT_CONCURRENCY``. Each
    section is logged individually by call_ghostwriter's _complete_ctx; per-
    section failures are isolated and the run always finishes."""
    tender = ws.read_json(ensure_normalized_tender(ws))
    try:
        kb = ws.read_json("corpus/bidder_knowledge_base.json")
    except FileNotFoundError:
        kb = {}
    sections = flatten_sections(outline)
    ds.init_status(ws, [str(s["id"]) for s in sections])
    ordered = sorted(sections, key=lambda n: _section_importance_key(n, tender))
    sem = asyncio.Semaphore(_DRAFT_CONCURRENCY)
    await asyncio.gather(
        *[
            _draft_section(
                sem,
                ws,
                n,
                tender=tender,
                kb=kb,
                model=model,
                model_config=model_config,
                project_id=project_id,
                user_id=user_id,
            )
            for n in ordered
        ]
    )
    ds.mark_finished(ws)


async def _run_drafting_parallel(
    project_id: int, user_id: int, model: str, model_config: dict | None
) -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        project = BidProjectService.get(db, user_id=user_id, project_id=project_id)
        if project is None:
            return
        ws = BidWorkspace(project.workspace_ref)
        try:
            outline = ws.read_json("workspace/outline.json")
        except FileNotFoundError:
            ds.mark_finished(ws, error="outline not built")
            project.status = "draft_failed"
            db.commit()
            return
        try:
            await run_drafting_parallel(
                ws=ws,
                outline=outline,
                model=model,
                model_config=model_config,
                project_id=project_id,
                user_id=user_id,
            )
            set_phase_done(db, project, 4)
        except BidPipelineError as e:
            ds.mark_finished(ws, error=str(e))
            project.status = "draft_failed"
            db.commit()
    finally:
        db.close()


def launch_drafting(
    project_id: int, user_id: int, model: str, model_config: dict | None
) -> None:
    asyncio.create_task(
        _run_drafting_parallel(project_id, user_id, model, model_config)
    )


# ---- redraft (specialist path; deferred from sandbox migration) -------------


async def redraft_one(
    ws: BidWorkspace,
    section_id: str,
    *,
    model: str,
    model_config: dict | None,
    instruction: str | None,
    project_id: int | None = None,
    user_id: int | None = None,
) -> None:
    ds.set_section_status(ws, section_id, "drafting")
    try:
        outline = ws.read_json("workspace/outline.json")
        tender = ws.read_json(ensure_normalized_tender(ws))
        try:
            kb = ws.read_json("corpus/bidder_knowledge_base.json")
        except FileNotFoundError:
            kb = {}
        node = find_section(outline, section_id)
        if node is None:
            raise BidPipelineError(f"section {section_id} not in outline")
        brief = materials_service.read_briefs(ws).get("briefs", {}).get(str(section_id))
        md = await call_ghostwriter(
            model=model,
            model_config=model_config,
            section=node,
            tender=tender,
            knowledge_base=kb,
            instruction=instruction,
            brief=brief,
            style_card=_STYLE_CARD,
            materials=section_retrieval.retrieve_for_section(ws, node, brief),
            project_id=project_id,
            user_id=user_id,
        )
        target = ws.path(f"workspace/sections/{section_id}.md")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(md, encoding="utf-8")
        ds.set_section_status(ws, section_id, "done")
    except Exception as e:  # isolate failure to this section
        logger.warning("redraft section %s failed: %s", section_id, e)
        ds.set_section_status(ws, section_id, "error")


async def _run_redraft(
    project_id: int,
    user_id: int,
    section_id: str,
    instruction: str | None,
    model: str,
    model_config: dict | None,
) -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        project = BidProjectService.get(db, user_id=user_id, project_id=project_id)
        if project is None:
            return
        ws = BidWorkspace(project.workspace_ref)
        await redraft_one(
            ws,
            section_id,
            model=model,
            model_config=model_config,
            instruction=instruction,
            project_id=project_id,
            user_id=user_id,
        )
    finally:
        db.close()


def launch_redraft(
    project_id: int,
    user_id: int,
    section_id: str,
    instruction: str | None,
    model: str,
    model_config: dict | None,
) -> None:
    asyncio.create_task(
        _run_redraft(project_id, user_id, section_id, instruction, model, model_config)
    )
