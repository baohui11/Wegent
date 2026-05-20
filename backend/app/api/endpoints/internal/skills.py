# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Internal Skills API for service-to-service communication.

Provides internal API for chat_shell to download skill binaries.
These endpoints are intended for service-to-service communication.

Authentication:
- In production, should be protected by network-level security
"""

import io
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.kind import Kind
from app.services.skill_binary_storage import skill_binary_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["internal-skills"])


@router.get("/{skill_id}/binary")
def get_skill_binary(
    skill_id: int,
    db: Session = Depends(get_db),
):
    """
    Download skill binary for internal service use.

    Always streams ZIP bytes through the backend (MySQL or S3-backed rows).
    Internal callers such as chat_shell must not rely on 302 redirects:
    older httpx clients treat redirects as errors unless follow_redirects
    is enabled.

    Only public skills (user_id=0) are accessible via this endpoint.
    """
    skill = (
        db.query(Kind)
        .filter(
            Kind.id == skill_id,
            Kind.user_id == 0,  # Only public skills
            Kind.kind == "Skill",
            Kind.is_active == True,  # noqa: E712
        )
        .first()
    )

    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    data = skill_binary_storage.get_bytes(db, kind_id=skill_id)
    if not data:
        raise HTTPException(status_code=404, detail="Skill binary not found")

    logger.info(
        "[internal_skills] Serving skill binary: skill_id=%d, name=%s, size=%d",
        skill_id,
        skill.name,
        len(data),
    )

    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={skill.name}.zip"},
    )
