# SPDX-License-Identifier: Apache-2.0
"""Persist one bid_llm_calls row per specialist LLM call. Best-effort: logging
must never break the pipeline, so failures are swallowed with a warning."""

import logging

logger = logging.getLogger(__name__)


def record(
    *,
    project_id: int | None,
    user_id: int | None,
    specialist: str,
    model: str,
    label: str = "",
    request: str,
    response: str,
    prompt_tokens: int,
    completion_tokens: int,
    duration_ms: int,
    status: str,
    error: str | None,
) -> None:
    if project_id is None or user_id is None:
        return  # no project context (e.g. isolated tests) -> skip logging
    from app.db.session import SessionLocal
    from app.models.bid_llm_call import BidLlmCall

    db = SessionLocal()
    try:
        db.add(
            BidLlmCall(
                project_id=project_id,
                user_id=user_id,
                specialist=specialist,
                label=label or "",
                model=model or "",
                request=request,
                response=response,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                duration_ms=duration_ms,
                status=status,
                error=error,
            )
        )
        db.commit()
    except Exception:
        logger.warning("bid llm_log record failed", exc_info=True)
        db.rollback()
    finally:
        db.close()
