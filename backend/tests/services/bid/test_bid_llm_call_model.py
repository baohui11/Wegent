# SPDX-License-Identifier: Apache-2.0
from app.models.bid_llm_call import BidLlmCall


def test_bid_llm_call_insert(test_db):
    row = BidLlmCall(
        project_id=1,
        user_id=1,
        specialist="ghostwriter",
        label="第一章 总体方案",
        model="m",
        request="req",
        response="res",
        prompt_tokens=10,
        completion_tokens=5,
        duration_ms=100,
        status="ok",
    )
    test_db.add(row)
    test_db.commit()
    got = test_db.query(BidLlmCall).filter_by(project_id=1).first()
    assert got.specialist == "ghostwriter" and got.prompt_tokens == 10
    assert got.label == "第一章 总体方案"
