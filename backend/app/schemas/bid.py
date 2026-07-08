# SPDX-License-Identifier: Apache-2.0
from datetime import datetime

from pydantic import BaseModel


class BidProjectCreate(BaseModel):
    title: str
    model_name: str = ""


class BidProjectResponse(BaseModel):
    id: int
    title: str
    workspace_ref: str
    current_phase: int
    max_phase_reached: int
    status: str
    model_name: str = ""
    created_at: datetime

    class Config:
        from_attributes = True


class ParseTriggerRequest(BaseModel):
    tender_text: str


class ParseTriggerResponse(BaseModel):
    status: str


class TenderDocResponse(BaseModel):
    tender: dict


class UncoveredItem(BaseModel):
    id: str
    text: str = ""
    target_section: str = ""


class CoverageResponse(BaseModel):
    total: int
    covered: int
    uncovered_scoring: list[UncoveredItem]
    uncovered_clauses: list[UncoveredItem]


class SectionGrounding(BaseModel):
    scoring: list[dict]
    clauses: list[dict]


class GroundingResponse(BaseModel):
    items: dict[str, SectionGrounding]


class OutlineResponse(BaseModel):
    outline: dict
    coverage: CoverageResponse


class OutlineSaveRequest(BaseModel):
    outline: dict


class OutlineStage3Response(BaseModel):
    outline: dict
    differs_from_stage1: bool


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


class GenerateBriefsRequest(BaseModel):
    node_ids: list[str]


class GenerateBriefsResponse(BaseModel):
    briefs: dict


class IngestResponse(BaseModel):
    results: dict


class BriefStatusResponse(BaseModel):
    total: int
    nodes: dict
    finished: bool
    error: str | None = None


class QualificationsResponse(BaseModel):
    qualifications: dict


class QualificationsSaveRequest(BaseModel):
    qualifications: dict


class AttachmentInfo(BaseModel):
    name: str
    size: int
    stats: dict | None = None


class AttachmentListResponse(BaseModel):
    items: list[AttachmentInfo]


class DraftStatusResponse(BaseModel):
    total: int
    sections: dict
    finished: bool
    error: str | None = None


class ExtractTextResponse(BaseModel):
    name: str
    size: int
    text: str


class SectionStatus(BaseModel):
    id: str
    status: str


class SectionListResponse(BaseModel):
    items: list[SectionStatus]


class SectionContentResponse(BaseModel):
    id: str
    content: str
    version: str = ""


class RedraftRequest(BaseModel):
    instruction: str | None = None


class SaveSectionRequest(BaseModel):
    content: str
    base_version: str


class SaveSectionResponse(BaseModel):
    version: str


class RedraftRangeRequest(BaseModel):
    start_line: int
    end_line: int
    instruction: str | None = None
    base_version: str


class ReviewStatusResponse(BaseModel):
    accepted: dict


class LlmCallInfo(BaseModel):
    id: int
    specialist: str
    label: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    duration_ms: int
    status: str
    created_at: datetime
    request: str
    response: str

    class Config:
        from_attributes = True


class LlmLogResponse(BaseModel):
    items: list[LlmCallInfo]


class ParseStageResponse(BaseModel):
    stage: str
