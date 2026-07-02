# SPDX-License-Identifier: Apache-2.0
"""Bid workbench API — phase 1 (project + 拆标 + files)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.bid import (
    BidProjectCreate,
    BidProjectResponse,
    ParseTriggerRequest,
    ParseTriggerResponse,
    TenderDocResponse,
)
from app.services.bid.model_resolver import resolve_tender_model
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
