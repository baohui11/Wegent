# SPDX-License-Identifier: Apache-2.0
from unittest.mock import patch

from app.models.bid_llm_call import BidLlmCall
from app.models.bid_project import BidProject
from app.services.bid import llm_log


def test_record_writes_row(test_db):
    with patch("app.db.session.SessionLocal", return_value=test_db):
        # patch close so the shared test_db session survives
        with patch.object(test_db, "close", lambda: None):
            llm_log.record(
                project_id=1,
                user_id=2,
                specialist="tender_sleuth",
                model="m",
                request="q",
                response="a",
                prompt_tokens=3,
                completion_tokens=4,
                duration_ms=50,
                status="ok",
                error=None,
            )
    assert (
        test_db.query(BidLlmCall).filter_by(project_id=1).first().specialist
        == "tender_sleuth"
    )


def test_record_skips_without_project():
    # no exception, no row (project_id None)
    llm_log.record(
        project_id=None,
        user_id=None,
        specialist="x",
        model="m",
        request="",
        response="",
        prompt_tokens=0,
        completion_tokens=0,
        duration_ms=0,
        status="ok",
        error=None,
    )


# ---- Task 7: callback tee (sandbox drafting observability, D8) --------------
#
# Drafting LLM calls happen inside the ClaudeCode sandbox and never come back
# through the chat_shell chokepoint, so bid_llm_calls would otherwise have no
# row for the whole phase. The executor_manager forwards /v1/responses events
# (including response.completed with usage) to /api/internal/callback; bid
# recognizes its own synthetic task_id (>= SYNTHETIC_BASE) and tees one row.


def _seed_project(test_db, project_id=30, user_id=2):
    proj = BidProject(
        id=project_id,
        user_id=user_id,
        title="t",
        workspace_ref=f"ws{project_id}",
        phase_status={},
        current_phase=4,
        max_phase_reached=4,
        status="drafting",
    )
    test_db.add(proj)
    test_db.commit()
    return proj


def test_record_sandbox_draft_writes_marker_row(test_db):
    # The ClaudeCode executor stream carries no usage, so bid records a
    # token-less turn marker from its own flow (D8 degrade).
    _seed_project(test_db, project_id=30, user_id=2)
    with patch("app.db.session.SessionLocal", return_value=test_db):
        with patch.object(test_db, "close", lambda: None):
            llm_log.record_sandbox_draft(
                project_id=30,
                user_id=2,
                model="mimo-v2.5",
                section_count=7,
                duration_ms=1234,
                status="ok",
            )
    row = test_db.query(BidLlmCall).filter_by(project_id=30).first()
    assert row is not None
    assert row.specialist == "ghostwriter-sandbox"
    assert row.label == "7 sections"
    assert row.model == "mimo-v2.5"
    assert row.prompt_tokens == 0 and row.completion_tokens == 0
    assert row.duration_ms == 1234 and row.status == "ok"


def test_record_sandbox_draft_error_row(test_db):
    _seed_project(test_db, project_id=31, user_id=2)
    with patch("app.db.session.SessionLocal", return_value=test_db):
        with patch.object(test_db, "close", lambda: None):
            llm_log.record_sandbox_draft(
                project_id=31,
                user_id=2,
                model="m",
                section_count=0,
                duration_ms=5,
                status="error",
                error="boom",
            )
    row = test_db.query(BidLlmCall).filter_by(project_id=31).first()
    assert row is not None
    assert row.status == "error" and "boom" in (row.error or "")
