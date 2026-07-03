# SPDX-License-Identifier: Apache-2.0
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid.specialists import call_fact_checker


@pytest.mark.asyncio
async def test_call_fact_checker_parses_verdicts():
    payload = {
        "verdicts": [
            {"id": "SF-000", "verdict": "unfaithful", "reason": "原文无此口径"}
        ]
    }
    with patch(
        "app.services.bid.specialists.complete_text",
        new=AsyncMock(return_value=json.dumps(payload, ensure_ascii=False)),
    ) as m:
        out = await call_fact_checker(
            model="m",
            model_config=None,
            tasks=[
                {
                    "id": "SF-000",
                    "type": "clause_faithfulness",
                    "claim": "c",
                    "candidate_sources": [],
                }
            ],
        )
    assert out == payload["verdicts"]
    # tasks are forwarded to the LLM
    assert "SF-000" in m.await_args.kwargs["input_messages"][0]["content"]


@pytest.mark.asyncio
async def test_call_fact_checker_empty_tasks_skips_llm():
    with patch("app.services.bid.specialists.complete_text", new=AsyncMock()) as m:
        out = await call_fact_checker(model="m", model_config=None, tasks=[])
    assert out == []
    m.assert_not_awaited()
