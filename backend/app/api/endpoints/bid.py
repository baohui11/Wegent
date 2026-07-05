# SPDX-License-Identifier: Apache-2.0
"""Bid workbench API — phase 1 (project + 拆标 + files)."""

import shutil
import uuid

import anyio
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.security import get_current_user
from app.models.bid_llm_call import BidLlmCall
from app.models.user import User
from app.schemas.bid import (
    AttachmentInfo,
    AttachmentListResponse,
    BidProjectCreate,
    BidProjectResponse,
    CoverageResponse,
    DraftStatusResponse,
    ExtractTextResponse,
    GroundingResponse,
    KnowledgeBaseResponse,
    KnowledgeBaseSaveRequest,
    LlmCallInfo,
    LlmLogResponse,
    NodeBriefsPayload,
    OutlineResponse,
    OutlineSaveRequest,
    PackageRequest,
    ParseStageResponse,
    ParseTriggerRequest,
    ParseTriggerResponse,
    QualificationsResponse,
    QualificationsSaveRequest,
    RedraftRequest,
    ReviewStatusResponse,
    ScoringContextResponse,
    SectionContentResponse,
    SectionGrounding,
    SectionListResponse,
    SectionStatus,
    SimpleStatusResponse,
    TenderDocResponse,
)
from app.services.bid import assemble_service, audit_service
from app.services.bid import drafting_service as drafting
from app.services.bid import materials_service as materials
from app.services.bid import review_service as review
from app.services.bid.coverage import compute_coverage, resolve_section_grounding
from app.services.bid.draft_pipeline import (
    find_section,
    flatten_sections,
    launch_drafting,
    launch_redraft,
)
from app.services.bid.model_resolver import (
    resolve_project_model,
    validate_model_config,
)
from app.services.bid.outline_pipeline import build_outline_for_project
from app.services.bid.outline_service import (
    read_outline,
    write_bid_config,
    write_outline,
)
from app.services.bid.parse_pipeline import (
    BidPipelineError,
    launch_parse,
    read_parse_stage,
)
from app.services.bid.project_service import BidProjectService
from app.services.bid.specialists import call_fact_checker
from app.services.bid.tender_extract import TenderExtractError, extract_text
from app.services.bid.workspace import BidWorkspace

router = APIRouter()


def _require(db, user, pid):
    p = BidProjectService.get(db, user_id=user.id, project_id=pid)
    if p is None:
        raise HTTPException(status_code=404, detail="bid project not found")
    return p


def _resolve_and_validate_model(db, user, project):
    """Resolve the project's model (or global fallback) and preflight-check it.

    An empty model name means "let chat_shell use its default" — that path is
    not validated. A named model with no resolvable credentials fails fast with
    a 422 instead of letting chat_shell silently emit lifecycle-only SSE.
    """
    model, model_config = resolve_project_model(db, user, project)
    if model:
        try:
            validate_model_config(model, model_config)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    return model, model_config


@router.post("/extract-text", response_model=ExtractTextResponse)
async def extract_tender_text(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    # Pre-project text extraction for the upload screen (docx/pdf/txt/md).
    content = await file.read()
    try:
        text = await anyio.to_thread.run_sync(
            extract_text, file.filename or "", content
        )
    except TenderExtractError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return ExtractTextResponse(name=file.filename or "", size=len(content), text=text)


@router.post("/projects", response_model=BidProjectResponse)
def create_project(
    body: BidProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return BidProjectService.create(
        db,
        user_id=current_user.id,
        title=body.title,
        workspace_ref=f"bid-{uuid.uuid4().hex[:12]}",
        model_name=body.model_name,
    )


@router.get("/projects", response_model=list[BidProjectResponse])
def list_projects(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return BidProjectService.list(db, user_id=current_user.id)


@router.get("/projects/{project_id}", response_model=BidProjectResponse)
def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _require(db, current_user, project_id)


@router.delete("/projects/{project_id}", response_model=SimpleStatusResponse)
def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    # Best-effort remove the workspace blackboard, then the ledger row.
    try:
        shutil.rmtree(BidWorkspace(project.workspace_ref).dir(), ignore_errors=True)
    except Exception:
        pass
    BidProjectService.delete(db, user_id=current_user.id, project_id=project_id)
    return SimpleStatusResponse(status="deleted")


@router.post("/projects/{project_id}/parse", response_model=ParseTriggerResponse)
async def parse_project(
    project_id: int,
    body: ParseTriggerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # async: launch_parse uses asyncio.create_task (needs a running loop).
    project = _require(db, current_user, project_id)
    if not BidProjectService.begin_parse(
        db, project_id=project.id, user_id=current_user.id
    ):
        raise HTTPException(status_code=409, detail="parse already running")
    # begin_parse uses a bulk UPDATE that bypasses the identity map; refresh so
    # the ORM object reflects the new status (and downstream GETs stay consistent).
    db.refresh(project)
    ws = BidWorkspace(project.workspace_ref)
    ws.write_tender_text(body.tender_text)
    model, model_config = _resolve_and_validate_model(db, current_user, project)
    # 拆标 is a minutes-long LLM pipeline; run it in the background and let the
    # client poll project status ('parsing' -> 'parsed'/'parse_failed').
    launch_parse(project.id, current_user.id, model, model_config)
    return ParseTriggerResponse(status="parsing")


@router.get("/projects/{project_id}/tender", response_model=TenderDocResponse)
def get_tender(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    if not ws.path("workspace/tender.json").exists():
        raise HTTPException(status_code=409, detail="tender not parsed yet")
    return TenderDocResponse(tender=ws.read_json("workspace/tender.json"))


@router.get("/projects/{project_id}/files")
def get_file(
    project_id: int,
    path: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    try:
        target = ws.path(path)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid path")
    if not target.exists():
        raise HTTPException(status_code=404, detail="file not found")
    if target.is_dir():
        return {
            "path": path,
            "entries": [
                {"name": c.name, "is_directory": c.is_dir()}
                for c in sorted(target.iterdir())
            ],
        }
    return {"path": path, "content": target.read_text(encoding="utf-8")}


def _read_tender_for_coverage(ws: BidWorkspace) -> dict:
    # Single canonical normalized projection; generated once on first read for
    # pre-existing projects whose parse predates the canonical write.
    from app.services.bid.tender_normalize import ensure_normalized_tender

    return ws.read_json(ensure_normalized_tender(ws))


def _coverage(ws) -> CoverageResponse:
    outline = read_outline(ws)
    tender = _read_tender_for_coverage(ws)
    return CoverageResponse(**compute_coverage(outline, tender))


def _grounding_items(ws: BidWorkspace) -> dict:
    outline = read_outline(ws)
    tender = _read_tender_for_coverage(ws)
    items: dict = {}
    for node in flatten_sections(outline):
        nid = node.get("id")
        if nid is None:
            continue
        g = resolve_section_grounding(node, tender)
        if g["scoring"] or g["clauses"]:
            items[str(nid)] = g
    return items


@router.get("/projects/{project_id}/llm-log", response_model=LlmLogResponse)
def get_llm_log(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require(db, current_user, project_id)  # ownership
    rows = (
        db.query(BidLlmCall)
        .filter(
            BidLlmCall.project_id == project_id,
            BidLlmCall.user_id == current_user.id,
        )
        .order_by(BidLlmCall.created_at.desc())
        .limit(200)
        .all()
    )
    return LlmLogResponse(items=[LlmCallInfo.model_validate(r) for r in rows])


@router.get("/projects/{project_id}/parse-stage", response_model=ParseStageResponse)
def get_parse_stage(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    return ParseStageResponse(
        stage=read_parse_stage(BidWorkspace(project.workspace_ref))
    )


@router.post("/projects/{project_id}/package", response_model=SimpleStatusResponse)
def declare_package(
    project_id: int,
    body: PackageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    write_bid_config(BidWorkspace(project.workspace_ref), body.package)
    return SimpleStatusResponse(status="declared")


@router.post("/projects/{project_id}/outline", response_model=OutlineResponse)
async def build_outline_endpoint(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    if not ws.path("workspace/tender.json").exists():
        raise HTTPException(status_code=409, detail="tender not parsed yet")
    try:
        await build_outline_for_project(ws)
    except BidPipelineError as e:
        raise HTTPException(status_code=422, detail=str(e))
    BidProjectService.set_phase_done(db, project=project, phase=2)
    return OutlineResponse(outline=read_outline(ws), coverage=_coverage(ws))


@router.get("/projects/{project_id}/outline", response_model=OutlineResponse)
def get_outline(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    try:
        outline = read_outline(ws)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="outline not built yet")
    return OutlineResponse(outline=outline, coverage=_coverage(ws))


@router.put("/projects/{project_id}/outline", response_model=OutlineResponse)
def save_outline(
    project_id: int,
    body: OutlineSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    try:
        write_outline(ws, body.outline)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return OutlineResponse(outline=read_outline(ws), coverage=_coverage(ws))


@router.get("/projects/{project_id}/coverage", response_model=CoverageResponse)
def get_coverage(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    if not ws.path("workspace/outline.json").exists():
        raise HTTPException(status_code=409, detail="outline not built yet")
    return _coverage(ws)


@router.get("/projects/{project_id}/grounding", response_model=GroundingResponse)
def get_grounding(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    if not ws.path("workspace/outline.json").exists():
        raise HTTPException(status_code=409, detail="outline not built yet")
    return GroundingResponse(
        items={k: SectionGrounding(**v) for k, v in _grounding_items(ws).items()}
    )


@router.get(
    "/projects/{project_id}/scoring-context",
    response_model=ScoringContextResponse,
)
def get_scoring_context(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    if (
        not ws.path("workspace/tender.json").exists()
        and not ws.path("workspace/tender_normalized.json").exists()
    ):
        return ScoringContextResponse(scoring=[], clauses=[])
    tender = _read_tender_for_coverage(ws)
    return ScoringContextResponse(
        scoring=tender.get("scoring", []) or [],
        clauses=tender.get("mandatory_clauses", []) or [],
    )


@router.get(
    "/projects/{project_id}/materials/knowledge-base",
    response_model=KnowledgeBaseResponse,
)
def get_knowledge_base(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    try:
        return KnowledgeBaseResponse(knowledge_base=materials.read_knowledge_base(ws))
    except FileNotFoundError:
        raise HTTPException(status_code=409, detail="knowledge base not set")


@router.put(
    "/projects/{project_id}/materials/knowledge-base",
    response_model=KnowledgeBaseResponse,
)
def put_knowledge_base(
    project_id: int,
    body: KnowledgeBaseSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    try:
        materials.write_knowledge_base(ws, body.knowledge_base)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return KnowledgeBaseResponse(knowledge_base=materials.read_knowledge_base(ws))


@router.get(
    "/projects/{project_id}/materials/qualifications",
    response_model=QualificationsResponse,
)
def get_qualifications(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    try:
        return QualificationsResponse(qualifications=materials.read_qualifications(ws))
    except FileNotFoundError:
        raise HTTPException(status_code=409, detail="qualifications not set")


@router.put(
    "/projects/{project_id}/materials/qualifications",
    response_model=QualificationsResponse,
)
def put_qualifications(
    project_id: int,
    body: QualificationsSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    try:
        materials.write_qualifications(ws, body.qualifications)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return QualificationsResponse(qualifications=materials.read_qualifications(ws))


@router.post(
    "/projects/{project_id}/materials/attachments", response_model=AttachmentInfo
)
async def upload_attachment(
    project_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    content = await file.read()
    try:
        info = materials.save_attachment(ws, file.filename or "", content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    from app.services.bid.tender_extract import extract_stats

    info["stats"] = extract_stats(file.filename or "", content)
    return AttachmentInfo(**info)


@router.get(
    "/projects/{project_id}/materials/attachments",
    response_model=AttachmentListResponse,
)
def get_attachments(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    return AttachmentListResponse(
        items=[AttachmentInfo(**a) for a in materials.list_attachments(ws)]
    )


@router.get("/projects/{project_id}/materials/briefs", response_model=NodeBriefsPayload)
def get_briefs(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    return NodeBriefsPayload(
        **materials.reconcile_briefs(ws, materials.read_briefs(ws))
    )


@router.put("/projects/{project_id}/materials/briefs", response_model=NodeBriefsPayload)
def put_briefs(
    project_id: int,
    body: NodeBriefsPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = BidWorkspace(_require(db, current_user, project_id).workspace_ref)
    try:
        materials.write_briefs(ws, body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return NodeBriefsPayload(**materials.read_briefs(ws))


@router.post(
    "/projects/{project_id}/materials/complete", response_model=SimpleStatusResponse
)
def complete_materials(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    BidProjectService.set_phase_done(db, project=project, phase=3)
    return SimpleStatusResponse(status="materials_done")


@router.post("/projects/{project_id}/draft", response_model=SimpleStatusResponse)
async def start_draft(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Must be async: launch_drafting() calls asyncio.create_task, which requires a
    # running event loop. A sync endpoint runs in a threadpool thread with no loop.
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    if not ws.path("workspace/outline.json").exists():
        raise HTTPException(status_code=409, detail="outline not built yet")
    if not BidProjectService.begin_draft(
        db, project_id=project.id, user_id=current_user.id
    ):
        raise HTTPException(status_code=409, detail="drafting already running")
    drafting.init_status(ws, [])  # placeholder; draft_all re-inits with real ids
    model, model_config = _resolve_and_validate_model(db, current_user, project)
    launch_drafting(project.id, current_user.id, model, model_config)
    return SimpleStatusResponse(status="drafting")


@router.get("/projects/{project_id}/draft/status", response_model=DraftStatusResponse)
def draft_status(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    return DraftStatusResponse(
        **drafting.read_status(BidWorkspace(project.workspace_ref))
    )


@router.get("/projects/{project_id}/sections", response_model=SectionListResponse)
def list_sections(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    st = drafting.read_status(ws)
    # Merge status entries with any section files on disk (a section may be
    # drafted before/without a status entry, e.g. pre-seeded artifacts).
    file_ids = drafting.list_section_files(ws)
    merged: dict[str, str] = dict(st["sections"])
    for fid in file_ids:
        merged.setdefault(fid, "done")
    return SectionListResponse(
        items=[SectionStatus(id=k, status=v) for k, v in merged.items()]
    )


@router.get(
    "/projects/{project_id}/sections/{section_id}",
    response_model=SectionContentResponse,
)
def get_section(
    project_id: int,
    section_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    try:
        content = drafting.read_section(BidWorkspace(project.workspace_ref), section_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="section not drafted yet")
    return SectionContentResponse(id=section_id, content=content)


@router.post(
    "/projects/{project_id}/sections/{section_id}/redraft",
    response_model=SimpleStatusResponse,
)
async def redraft_section(
    project_id: int,
    section_id: str,
    body: RedraftRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # async: launch_redraft uses asyncio.create_task (needs a running loop).
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    outline = (
        ws.read_json("workspace/outline.json")
        if ws.path("workspace/outline.json").exists()
        else {}
    )
    if find_section(outline, section_id) is None:
        raise HTTPException(status_code=404, detail="section not in outline")
    drafting.set_section_status(ws, section_id, "drafting")
    model, model_config = _resolve_and_validate_model(db, current_user, project)
    launch_redraft(
        project.id, current_user.id, section_id, body.instruction, model, model_config
    )
    return SimpleStatusResponse(status="drafting")


@router.post(
    "/projects/{project_id}/sections/{section_id}/accept",
    response_model=SimpleStatusResponse,
)
def accept_section(
    project_id: int,
    section_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    review.mark_accepted(BidWorkspace(project.workspace_ref), section_id)
    return SimpleStatusResponse(status="accepted")


@router.get("/projects/{project_id}/review/status", response_model=ReviewStatusResponse)
def review_status(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    return ReviewStatusResponse(
        **review.read_review(BidWorkspace(project.workspace_ref))
    )


@router.post(
    "/projects/{project_id}/review/complete", response_model=SimpleStatusResponse
)
def complete_review(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    BidProjectService.set_phase_done(db, project=project, phase=5)
    return SimpleStatusResponse(status="review_done")


_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@router.post("/projects/{project_id}/audit")
async def run_audit_endpoint(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Health-check (rework gate): does NOT advance phase; may loop back to ④⑤.
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    try:
        return await anyio.to_thread.run_sync(audit_service.run_audit, ws)
    except BidPipelineError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/projects/{project_id}/audit/report")
def get_audit_report(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    report = audit_service.read_report(BidWorkspace(project.workspace_ref))
    if report is None:
        raise HTTPException(status_code=404, detail="no audit report")
    return report


@router.post("/projects/{project_id}/finalize", response_model=SimpleStatusResponse)
async def finalize_bid(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    try:
        await anyio.to_thread.run_sync(assemble_service.finalize, ws)
    except BidPipelineError as e:
        raise HTTPException(status_code=422, detail=str(e))
    BidProjectService.set_phase_done(db, project=project, phase=6)
    BidProjectService.mark_done(db, project=project)
    return SimpleStatusResponse(status="finalized")


@router.get("/projects/{project_id}/download")
def download_bid(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    path = BidWorkspace(project.workspace_ref).path(assemble_service.DOCX_REL)
    if not path.exists():
        raise HTTPException(status_code=404, detail="not finalized yet")
    # Starlette FileResponse emits RFC 5987 filename* for the non-ASCII name.
    return FileResponse(str(path), media_type=_DOCX_MIME, filename="投标文件.docx")


@router.post("/projects/{project_id}/audit/verify")
async def verify_audit(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Second layer (LLM): judge fidelity tasks -> verdicts -> re-run audit with
    # --verdicts to fold them in. Rework gate: does NOT advance phase.
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    tasks = audit_service.read_fidelity_tasks(ws)
    if not tasks:
        report = audit_service.read_report(ws)
        if report is None:
            raise HTTPException(status_code=409, detail="run audit first")
        return report
    model, model_config = _resolve_and_validate_model(db, current_user, project)
    verdicts = await call_fact_checker(
        model=model,
        model_config=model_config,
        tasks=tasks,
        project_id=project_id,
        user_id=current_user.id,
    )
    audit_service.write_verdicts(ws, verdicts)
    try:
        return await anyio.to_thread.run_sync(audit_service.run_audit_verdicts, ws)
    except BidPipelineError as e:
        raise HTTPException(status_code=422, detail=str(e))
