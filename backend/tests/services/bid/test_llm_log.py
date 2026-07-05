# SPDX-License-Identifier: Apache-2.0
from unittest.mock import patch

from app.models.bid_llm_call import BidLlmCall
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
