# SPDX-License-Identifier: Apache-2.0
from datetime import datetime

from pydantic import BaseModel


class BidProjectCreate(BaseModel):
    title: str


class BidProjectResponse(BaseModel):
    id: int
    title: str
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
