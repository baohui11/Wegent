# SPDX-License-Identifier: Apache-2.0
from unittest.mock import patch

from app.models.bid_llm_call import BidLlmCall
from app.models.bid_project import BidProject
from app.services.bid import llm_log
from app.services.bid.sandbox_config import SYNTHETIC_BASE, synthetic_task_id


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


def test_record_from_callback_writes_usage_for_synthetic_task_id(test_db):
    _seed_project(test_db, project_id=30, user_id=2)
    tid = synthetic_task_id(30)
    event = {
        "type": "response.completed",
        "response": {
            "usage": {"input_tokens": 110, "output_tokens": 220, "total_tokens": 330}
        },
    }
    llm_log.record_from_callback(
        test_db,
        task_id=tid,
        subtask_id=tid,
        event_type="response.completed",
        event=event,
    )
    row = test_db.query(BidLlmCall).filter_by(project_id=30).first()
    assert row is not None
    assert row.specialist == "ghostwriter-sandbox"
    assert row.prompt_tokens == 110
    assert row.completion_tokens == 220
    assert row.model == ""  # sandbox agent; no single specialist model


def test_record_from_callback_skips_real_task_ids(test_db):
    # Real Task ids (< SYNTHETIC_BASE) belong to the Task system, not bid; the
    # tee must not write a bid_llm_calls row for them.
    event = {"type": "response.completed", "response": {"usage": {"input_tokens": 1}}}
    llm_log.record_from_callback(
        test_db,
        task_id=12345,
        subtask_id=12345,
        event_type="response.completed",
        event=event,
    )
    assert test_db.query(BidLlmCall).count() == 0


def test_record_from_callback_ignores_non_completed_events(test_db):
    _seed_project(test_db, project_id=31, user_id=2)
    tid = synthetic_task_id(31)
    # Non-terminal events carry no usage; skip them silently.
    llm_log.record_from_callback(
        test_db,
        task_id=tid,
        subtask_id=tid,
        event_type="response.output_text.delta",
        event={"type": "response.output_text.delta"},
    )
    assert test_db.query(BidLlmCall).count() == 0


def test_record_from_callback_marks_error_on_error_event(test_db):
    _seed_project(test_db, project_id=32, user_id=2)
    tid = synthetic_task_id(32)
    event = {"type": "response.failed", "error": {"message": "boom"}}
    llm_log.record_from_callback(
        test_db,
        task_id=tid,
        subtask_id=tid,
        event_type="response.failed",
        event=event,
    )
    row = test_db.query(BidLlmCall).filter_by(project_id=32).first()
    assert row is not None
    assert row.status == "error"
    assert "boom" in (row.error or "")
