# SPDX-License-Identifier: Apache-2.0
"""Persist one bid_llm_calls row per specialist LLM call. Best-effort: logging
must never break the pipeline, so failures are swallowed with a warning."""

import logging

from app.services.bid.sandbox_config import SYNTHETIC_BASE

logger = logging.getLogger(__name__)

# Specialist tag used for sandbox-drafted rows (the drafting agent itself).
_GHOSTWRITER_SANDBOX = "ghostwriter-sandbox"

# Event types that carry a final usage payload or an error. Non-terminal events
# (deltas, tool calls, ...) are ignored — usage is only known at completion.
_TERMINAL_EVENTS = {
    "response.completed",
    "response.failed",
    "response.error",
}


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


def record_from_callback(
    db,
    *,
    task_id: int,
    subtask_id: int,
    event_type: str,
    event: dict,
) -> None:
    """Tee one ``bid_llm_calls`` row from a sandbox-drafting callback event.

    Drafting runs as a ClaudeCode sandbox agent, so its LLM calls bypass the
    chat_shell chokepoint that feeds :func:`record`. Instead the executor_manager
    forwards ``/v1/responses`` events (incl. ``response.completed`` with usage)
    to ``/api/internal/callback``; this function recognizes bid's synthetic
    task_id (``>= SYNTHETIC_BASE``) and records a single aggregated row.

    Accepted trade-off (D8): we only get turn-level aggregated usage + no
    per-call request/response body — the per-call parse-log panel degrades to a
    single "ghostwriter-sandbox" row for the whole draft.

    Best-effort: failures are swallowed (logging must never break the callback
    handler)."""
    if task_id < SYNTHETIC_BASE:
        # Real Task ids belong to the Task system, not bid — leave them alone.
        return
    if event_type not in _TERMINAL_EVENTS:
        return

    project_id = task_id - SYNTHETIC_BASE
    event = event or {}

    status = "ok"
    error = None
    prompt_tokens = 0
    completion_tokens = 0
    if event_type != "response.completed":
        # Failure / error event: record an error row (no usage).
        status = "error"
        err_obj = event.get("error")
        error = (
            err_obj.get("message")
            if isinstance(err_obj, dict)
            else (str(err_obj) if err_obj else event_type)
        )
    else:
        # C4 verified usage path: response.usage.{input,output}_tokens.
        usage = (event.get("response") or {}).get("usage") or {}
        prompt_tokens = int(usage.get("input_tokens") or 0)
        completion_tokens = int(usage.get("output_tokens") or 0)

    try:
        # Resolve the owning user from the project row; default to 0 (system)
        # if the project vanished (callback after deletion, etc.).
        from app.models.bid_llm_call import BidLlmCall
        from app.models.bid_project import BidProject

        user_id = (
            db.query(BidProject.user_id).filter(BidProject.id == project_id).scalar()
        ) or 0

        db.add(
            BidLlmCall(
                project_id=project_id,
                user_id=user_id,
                specialist=_GHOSTWRITER_SANDBOX,
                model="",
                label="",
                request="",
                response="",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                duration_ms=0,
                status=status,
                error=error,
            )
        )
        db.commit()
    except Exception:
        logger.warning("bid llm_log record_from_callback failed", exc_info=True)
        db.rollback()
