# SPDX-License-Identifier: Apache-2.0
"""Phase 4 (起草) orchestration: background, concurrency-bounded drafting."""

import asyncio
import logging

from app.services.bid import drafting_service as ds
from app.services.bid.parse_pipeline import BidPipelineError
from app.services.bid.project_service import BidProjectService
from app.services.bid.specialists import call_ghostwriter
from app.services.bid.workspace import BidWorkspace

logger = logging.getLogger(__name__)


def flatten_sections(outline: dict) -> list[dict]:
    out: list[dict] = []

    def walk(nodes):
        for n in nodes or []:
            if n.get("id") is not None:
                out.append(n)
            walk(n.get("children"))

    walk(outline.get("sections"))
    return out


async def draft_all(
    ws: BidWorkspace, *, model: str, model_config: dict | None, concurrency: int = 3
) -> None:
    outline = ws.read_json("workspace/outline.json")
    tender = ws.read_json("workspace/tender.json")
    try:
        kb = ws.read_json("corpus/bidder_knowledge_base.json")
    except FileNotFoundError:
        kb = {}
    sections = flatten_sections(outline)
    ds.init_status(ws, [str(s["id"]) for s in sections])
    sem = asyncio.Semaphore(concurrency)

    async def one(section: dict) -> None:
        sid = str(section["id"])
        async with sem:
            ds.set_section_status(ws, sid, "drafting")
            try:
                md = await call_ghostwriter(
                    model=model,
                    model_config=model_config,
                    section=section,
                    tender=tender,
                    knowledge_base=kb,
                )
                target = ws.path(f"workspace/sections/{sid}.md")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(md, encoding="utf-8")
                ds.set_section_status(ws, sid, "done")
            except Exception as e:  # per-section failure is isolated, not fatal
                logger.warning("draft section %s failed: %s", sid, e)
                ds.set_section_status(ws, sid, "error")

    await asyncio.gather(*[one(s) for s in sections])
    ds.mark_finished(ws)


async def _run_drafting(
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
            await draft_all(ws, model=model, model_config=model_config)
            BidProjectService.set_phase_done(db, project=project, phase=4)
        except BidPipelineError as e:
            ds.mark_finished(ws, error=str(e))
            project.status = "draft_failed"
            db.commit()
    finally:
        db.close()


def launch_drafting(
    project_id: int, user_id: int, model: str, model_config: dict | None
) -> None:
    asyncio.create_task(_run_drafting(project_id, user_id, model, model_config))
