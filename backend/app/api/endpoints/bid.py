# SPDX-License-Identifier: Apache-2.0
"""Bid workbench API — phase 1 (project + 拆标 + files)."""

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.bid import (
    AttachmentInfo,
    AttachmentListResponse,
    BidProjectCreate,
    BidProjectResponse,
    CoverageResponse,
    DraftStatusResponse,
    KnowledgeBaseResponse,
    KnowledgeBaseSaveRequest,
    OutlineResponse,
    OutlineSaveRequest,
    PackageRequest,
    ParseTriggerRequest,
    ParseTriggerResponse,
    QualificationsResponse,
    QualificationsSaveRequest,
    SectionContentResponse,
    SectionListResponse,
    SectionStatus,
    SimpleStatusResponse,
    TenderDocResponse,
)
from app.services.bid import drafting_service as drafting
from app.services.bid import materials_service as materials
from app.services.bid.coverage import compute_coverage
from app.services.bid.draft_pipeline import launch_drafting
from app.services.bid.model_resolver import resolve_tender_model
from app.services.bid.outline_pipeline import build_outline_for_project
from app.services.bid.outline_service import (
    read_outline,
    write_bid_config,
    write_outline,
)
from app.services.bid.parse_pipeline import BidPipelineError, parse_tender
from app.services.bid.project_service import BidProjectService
from app.services.bid.workspace import BidWorkspace

router = APIRouter()


def _require(db, user, pid):
    p = BidProjectService.get(db, user_id=user.id, project_id=pid)
    if p is None:
        raise HTTPException(status_code=404, detail="bid project not found")
    return p


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


@router.post("/projects/{project_id}/parse", response_model=ParseTriggerResponse)
async def parse_project(
    project_id: int,
    body: ParseTriggerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    if not BidProjectService.begin_parse(
        db, project_id=project.id, user_id=current_user.id
    ):
        raise HTTPException(status_code=409, detail="parse already running")
    ws = BidWorkspace(project.workspace_ref)
    try:
        ws.write_tender_text(body.tender_text)
        model, model_config = resolve_tender_model(db, current_user)
        await parse_tender(ws, model=model, model_config=model_config)
    except BidPipelineError as e:
        project.status = "parse_failed"
        db.commit()
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        # Never leave the project stuck in 'parsing' on unexpected failure;
        # begin_parse holds the lock via status, so release it on any error.
        project.status = "parse_failed"
        db.commit()
        raise
    BidProjectService.complete_phase1(db, project=project)
    return ParseTriggerResponse(status="parsed")


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


def _coverage(ws) -> CoverageResponse:
    outline = read_outline(ws)
    tender = ws.read_json("workspace/tender.json")
    return CoverageResponse(**compute_coverage(outline, tender))


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
        raise HTTPException(status_code=409, detail="outline not built yet")
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
def start_draft(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require(db, current_user, project_id)
    ws = BidWorkspace(project.workspace_ref)
    if not ws.path("workspace/outline.json").exists():
        raise HTTPException(status_code=409, detail="outline not built yet")
    if not BidProjectService.begin_draft(
        db, project_id=project.id, user_id=current_user.id
    ):
        raise HTTPException(status_code=409, detail="drafting already running")
    drafting.init_status(ws, [])  # placeholder; draft_all re-inits with real ids
    model, model_config = resolve_tender_model(db, current_user)
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
