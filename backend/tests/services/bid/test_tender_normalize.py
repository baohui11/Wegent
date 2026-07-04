# SPDX-License-Identifier: Apache-2.0
from app.services.bid.tender_normalize import normalize_clauses, normalize_scoring


def test_normalize_scoring_bucketed_shape():
    # Real qwen shape: items split across tech_items/biz_items/price_items,
    # each item using title/max_score (not item/weight).
    tender = {
        "scoring": {
            "total_tech_score": 70,
            "tech_items": [
                {
                    "id": "T1",
                    "title": "总体方案",
                    "max_score": 20,
                    "target_section": None,
                },
                {"id": "T2", "title": "数据安全", "max_score": 15},
            ],
            "biz_items": [{"id": "M1", "title": "类似业绩", "max_score": 10}],
            "price_items": [{"id": "B1", "title": "投标报价", "max_score": 30}],
        }
    }
    out = normalize_scoring(tender)
    assert [s["id"] for s in out] == ["T1", "T2", "M1", "B1"]
    t1 = out[0]
    assert t1["item"] == "总体方案" and t1["weight"] == 20 and t1["category"] == "技术"
    # price bucket -> 价格 (excluded from coverage downstream)
    assert out[-1]["category"] == "价格"


def test_normalize_scoring_still_handles_items_and_list():
    assert (
        normalize_scoring({"scoring": {"items": [{"code": "S1", "score": 5}]}})[0]["id"]
        == "S1"
    )
    assert normalize_scoring({"scoring": [{"id": "X", "score": 3}]})[0]["weight"] == 3


def test_normalize_clauses_maps_is_veto():
    clauses = [
        {"id": "M1", "is_veto": True, "clause_text": "..."},
        {"id": "M2", "veto": True},
        {"id": "M3", "is_veto": None},
    ]
    out = normalize_clauses(clauses)
    assert out[0]["veto"] is True  # is_veto -> veto
    assert out[1]["veto"] is True  # already veto -> preserved
    assert out[2]["veto"] is False  # None -> False
    assert normalize_clauses(None) == []


def test_normalized_tender_full():
    from app.services.bid.tender_normalize import normalized_tender

    t = {
        "scoring": {"tech_items": [{"id": "T1", "title": "方案", "max_score": 20}]},
        "mandatory_clauses": [{"id": "M1", "is_veto": True}],
        "project": {"name": "X"},
    }
    out = normalized_tender(t)
    assert isinstance(out["scoring"], list) and out["scoring"][0]["weight"] == 20
    assert out["mandatory_clauses"][0]["veto"] is True
    assert out["project"] == {"name": "X"}  # untouched passthrough
