# SPDX-License-Identifier: Apache-2.0
"""Phase 4 (起草) orchestration.

Drafting runs as a ClaudeCode sandbox agent: bid spins up a sandbox via
executor_manager, seeds the project corpus into it over envd, fires the agent
through ``/v1/responses`` (the agent uses the ``bid-section-writer`` skill to
read the corpus on demand and write each section), then reads the section
markdown back over envd while the sandbox is alive. The specialist-based
per-section path (``call_ghostwriter``) is retained only for single-section
redraft (deferred from the sandbox migration)."""

import asyncio
import json
import logging
import time

from app.core.config import settings
from app.services.bid import drafting_service as ds
from app.services.bid import llm_log, materials_service
from app.services.bid import sandbox_config as sc
from app.services.bid.parse_pipeline import BidPipelineError
from app.services.bid.project_service import BidProjectService
from app.services.bid.sandbox_runtime import SandboxRuntime
from app.services.bid.skill_registrar import ensure_bid_skill_registered
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

# How long to wait for a single section file to appear in the sandbox (C2:
# completion = poll envd output file). Sections are produced sequentially by the
# agent, so this is per-section, not for the whole draft.
_SECTION_AWAIT_POLL_S = 4
_SECTION_AWAIT_MAX_TRIES = 90

# Where the agent writes section markdown inside the sandbox (matches the
# bid-section-writer SKILL.md contract).
_SECTION_REMOTE_DIR = "/home/user/sections"


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
            md = await call_ghostwriter(
                model=model,
                model_config=model_config,
                section=node,
                tender=tender,
                knowledge_base=kb,
                brief=brief,
                style_card=_STYLE_CARD,
                project_id=project_id,
                user_id=user_id,
            )
            target = ws.path(f"workspace/sections/{sid}.md")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(md, encoding="utf-8")
            ds.set_section_status(ws, sid, "done")
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


# ---- sandbox drafting (full draft) ------------------------------------------


async def _seed_corpus(rt: SandboxRuntime, envd: str, ws: BidWorkspace) -> None:
    """Upload the project corpus into the sandbox ``/home/user`` workspace.

    The agent reads these on demand (per the bid-section-writer methodology) so
    uploaded materials actually drive the drafting instead of being dead storage.
    Missing files are skipped (not every project has qualifications/briefs)."""
    # JSON artifacts: seed the CANONICAL normalized tender (so the drafting agent
    # sees the same scoring/clauses shape as coverage/UI), plus outline, briefs,
    # knowledge base, qualifications.
    json_rels = [
        (ensure_normalized_tender(ws), "tender.json"),
        ("workspace/outline.json", "outline.json"),
        ("corpus/node_briefs.json", "node_briefs.json"),
        ("corpus/bidder_knowledge_base.json", "bidder_knowledge_base.json"),
        ("corpus/qualifications.json", "qualifications.json"),
    ]
    for rel, name in json_rels:
        p = ws.path(rel)
        if not p.exists():
            continue
        await rt.seed_file(envd, f"/home/user/{name}", p.read_bytes(), name)
    # Raw attachment files (PDFs, images, ...): the agent reads/extracts them
    # in-container (D6/D10 — materials actually enter drafting).
    attach_dir = ws.path("corpus/attachments")
    if attach_dir.is_dir():
        for f in sorted(attach_dir.iterdir()):
            if f.is_file():
                await rt.seed_file(
                    envd,
                    f"/home/user/corpus/attachments/{f.name}",
                    f.read_bytes(),
                    f.name,
                )
    # Per-section grounding (scoring/veto clauses each node must cover), resolved
    # once by the backend so the agent doesn't re-derive coverage from raw covers
    # (R2). Written as grounding.json; the prompt points the agent at it.
    if ws.path("workspace/outline.json").exists():
        from app.services.bid.coverage import resolve_section_grounding

        tender_norm = ws.read_json(ensure_normalized_tender(ws))
        outline = ws.read_json("workspace/outline.json")
        grounding: dict = {}
        for n in flatten_sections(outline):
            nid = n.get("id")
            if nid is None:
                continue
            g = resolve_section_grounding(n, tender_norm)
            if g["scoring"] or g["clauses"]:
                grounding[str(nid)] = g
        await rt.seed_file(
            envd,
            "/home/user/grounding.json",
            json.dumps(grounding, ensure_ascii=False).encode("utf-8"),
            "grounding.json",
        )


def _drafting_prompt(outline: dict) -> tuple[str, str]:
    """Build (prompt, instructions) guiding the agent to draft every outline
    section to ``/home/user/sections/<id>.md`` using the bid-section-writer
    skill and the seeded corpus."""
    section_ids = [str(s["id"]) for s in flatten_sections(outline)]
    instructions = (
        "You are a bid proposal technical writer. Use the `bid-section-writer` "
        "skill's methodology: respond point-by-point, ground every claim in the "
        "seeded corpus, and avoid fabrication. Before writing a section, inspect "
        "the relevant materials under /home/user/ (tender.json, outline.json, "
        "node_briefs.json, bidder_knowledge_base.json, qualifications.json, and "
        "corpus/attachments/*) and read what you need."
        " /home/user/grounding.json 给出每个 section id 必须覆盖的评分项(scoring)"
        "与否决条款(clauses)；撰写该节时逐条覆盖、不得遗漏。"
        " 每个章节在 node_briefs.json 里可能有对应 id 的编写要求（writing_brief："
        f"{materials_service.NODE_BRIEF_FIELDS_ZH}）。若存在，本节正文必须遵守这些"
        "要求；如与评分项覆盖冲突，以覆盖评分项为先。"
    )
    prompt = (
        f"Draft every outline section listed below into Markdown, one file per "
        f"section at `/home/user/sections/<section_id>.md`. Section ids to "
        f"produce: {', '.join(section_ids)}. Do not skip any. Write each file "
        f"with the section's id as the filename stem (e.g. "
        f"/home/user/sections/{section_ids[0] if section_ids else '<id>'}.md)."
    )
    return prompt, instructions


async def _collect_sections(
    rt: SandboxRuntime, envd: str, ws: BidWorkspace, outline: dict
) -> None:
    """Await + read each section back from the sandbox and persist it to the
    project workspace, updating drafting status as we go."""
    sections = flatten_sections(outline)
    for section in sections:
        sid = str(section["id"])
        remote = f"{_SECTION_REMOTE_DIR}/{sid}.md"
        ds.set_section_status(ws, sid, "drafting")
        present = await rt.await_file(
            envd,
            remote,
            poll_s=_SECTION_AWAIT_POLL_S,
            max_tries=_SECTION_AWAIT_MAX_TRIES,
        )
        if not present:
            logger.warning("section %s never appeared in sandbox", sid)
            ds.set_section_status(ws, sid, "error")
            continue
        body = await rt.read_file(envd, remote)
        if body is None:
            ds.set_section_status(ws, sid, "error")
            continue
        target = ws.path(f"workspace/sections/{sid}.md")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        ds.set_section_status(ws, sid, "done")


async def run_drafting_sandbox(
    *,
    db,
    workspace: BidWorkspace,
    outline: dict,
    project_id: int,
    user_id: int,
    user_name: str,
    model: str,
    model_config: dict | None,
) -> None:
    """Run full drafting as a ClaudeCode sandbox agent.

    Lifecycle (D9): create sandbox -> wait running -> seed corpus -> fire agent
    via /v1/responses (C1) -> collect sections by polling envd (C2) -> mark
    phase done -> delete sandbox. The sandbox is always cleaned up in ``finally``.
    """
    bot_env = sc.build_bot_config(model, model_config)  # Task 1: ANTHROPIC_* env
    tid = sc.synthetic_task_id(project_id)

    ensure_bid_skill_registered(db)  # executor must be able to pull the skill

    rt = SandboxRuntime(
        em_url=settings.EXECUTOR_MANAGER_URL,
        rewrite_host=settings.BID_SANDBOX_REWRITE_HOST,
    )

    sections = flatten_sections(outline)
    ds.init_status(workspace, [str(s["id"]) for s in sections])

    sid = await rt.create(
        task_id=tid,
        user_id=user_id,
        user_name=user_name,
        bot_config=bot_env,
    )
    start = time.monotonic()
    try:
        envd = await rt.wait_running(sid)
        await _seed_corpus(rt, envd, workspace)
        prompt, instructions = _drafting_prompt(outline)
        await rt.run_agent(
            envd,
            prompt=prompt,
            instructions=instructions,
            model=model,
            model_config=model_config,
            bot_env=bot_env,
            task_id=tid,
            subtask_id=tid,
            user_id=user_id,
            user_name=user_name,
        )
        await _collect_sections(rt, envd, workspace, outline)
        ds.mark_finished(workspace)
        # The ClaudeCode executor stream carries no usage; record a token-less
        # turn marker from bid's own flow so bid_llm_calls still reflects the
        # draft (D8 degrade).
        llm_log.record_sandbox_draft(
            project_id=project_id,
            user_id=user_id,
            model=model,
            section_count=len(sections),
            duration_ms=int((time.monotonic() - start) * 1000),
            status="ok",
        )
    except Exception as e:
        # Surface agent/infra failures on the status file so the frontend can
        # show them; the sandbox is still torn down below.
        ds.mark_finished(workspace, error=str(e))
        llm_log.record_sandbox_draft(
            project_id=project_id,
            user_id=user_id,
            model=model,
            section_count=len(sections),
            duration_ms=int((time.monotonic() - start) * 1000),
            status="error",
            error=str(e),
        )
        raise
    finally:
        await rt.delete(sid)


def set_phase_done(db, project, phase: int) -> None:
    """Thin wrapper so tests can patch phase transition without DB."""
    BidProjectService.set_phase_done(db, project=project, phase=phase)


async def _run_drafting_sandbox(
    project_id: int, user_id: int, model: str, model_config: dict | None
) -> None:
    from app.db.session import SessionLocal
    from app.models.user import User

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
        # run_drafting_sandbox needs user.user_name for the sandbox create payload.
        user = db.query(User).filter(User.id == user_id).first()
        try:
            await run_drafting_sandbox(
                db=db,
                workspace=ws,
                outline=outline,
                project_id=project_id,
                user_id=user_id,
                user_name=(user.user_name if user else ""),
                model=model,
                model_config=model_config,
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
    asyncio.create_task(_run_drafting_sandbox(project_id, user_id, model, model_config))


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
