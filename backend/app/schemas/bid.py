# SPDX-License-Identifier: Apache-2.0
from datetime import datetime

from pydantic import BaseModel


class BidProjectCreate(BaseModel):
    title: str


class BidProjectResponse(BaseModel):
    id: int
    title: str
    workspace_ref: str
    current_phase: int
    max_phase_reached: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ParseTriggerRequest(BaseModel):
    tender_text: str


class ParseTriggerResponse(BaseModel):
    status: str


class TenderDocResponse(BaseModel):
    tender: dict


class CoverageResponse(BaseModel):
    total: int
    covered: int
    uncovered_scoring: list[str]
    uncovered_clauses: list[str]


class OutlineResponse(BaseModel):
    outline: dict
    coverage: CoverageResponse


class OutlineSaveRequest(BaseModel):
    outline: dict


class PackageRequest(BaseModel):
    package: str


class SimpleStatusResponse(BaseModel):
    status: str


class KnowledgeBaseResponse(BaseModel):
    knowledge_base: dict


class KnowledgeBaseSaveRequest(BaseModel):
    knowledge_base: dict


class NodeBriefsPayload(BaseModel):
    briefs: dict
    materials: list = []


class QualificationsResponse(BaseModel):
    qualifications: dict


class QualificationsSaveRequest(BaseModel):
    qualifications: dict


class AttachmentInfo(BaseModel):
    name: str
    size: int


class AttachmentListResponse(BaseModel):
    items: list[AttachmentInfo]


class DraftStatusResponse(BaseModel):
    total: int
    sections: dict
    finished: bool
    error: str | None = None


class SectionStatus(BaseModel):
    id: str
    status: str


class SectionListResponse(BaseModel):
    items: list[SectionStatus]


class SectionContentResponse(BaseModel):
    id: str
    content: str


class RedraftRequest(BaseModel):
    instruction: str | None = None


class ReviewStatusResponse(BaseModel):
    accepted: dict
