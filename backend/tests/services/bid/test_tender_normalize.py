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


def test_normalize_clauses_canonicalizes_text():
    # qwen/mimo emit clause text under varying keys; converge onto `text` so
    # consumers (scoring-context / materials panel) never fall back to the id.
    assert (
        normalize_clauses([{"id": "MC-002", "clause": "投标保证金16万", "veto": True}])[
            0
        ]["text"]
        == "投标保证金16万"
    )
    assert (
        normalize_clauses([{"id": "MC-01", "原文": "封面盖章", "is_veto": False}])[0][
            "text"
        ]
        == "封面盖章"
    )
    assert normalize_clauses([{"id": "X", "text": "已是text"}])[0]["text"] == "已是text"
    assert normalize_clauses([{"id": "Y"}])[0]["text"] == ""


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


def test_ensure_normalized_tender_generates_when_absent(tmp_path):
    from app.services.bid.tender_normalize import ensure_normalized_tender
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("norm-gen", root=tmp_path)
    ws.write_json(
        "workspace/tender.json",
        {
            "scoring": {"tech_items": [{"id": "T1", "title": "方案", "max_score": 20}]},
            "mandatory_clauses": [
                {"id": "M1", "is_veto": True, "clause": "有效期90天"}
            ],
        },
    )
    assert not ws.path("workspace/tender_normalized.json").exists()

    rel = ensure_normalized_tender(ws)

    assert rel == "workspace/tender_normalized.json"
    norm = ws.read_json(rel)
    # scoring flattened to a list carrying canonical id/item; clause veto-aligned + text
    assert isinstance(norm["scoring"], list) and norm["scoring"][0]["id"] == "T1"
    assert norm["mandatory_clauses"][0]["veto"] is True
    assert norm["mandatory_clauses"][0]["text"] == "有效期90天"
    # raw tender.json is never mutated (scoring still the bucketed dict)
    assert isinstance(ws.read_json("workspace/tender.json")["scoring"], dict)


def test_ensure_normalized_tender_is_idempotent(tmp_path):
    from app.services.bid.tender_normalize import ensure_normalized_tender
    from app.services.bid.workspace import BidWorkspace

    ws = BidWorkspace("norm-idem", root=tmp_path)
    ws.write_json("workspace/tender.json", {"scoring": []})
    # pre-existing canonical file must NOT be regenerated/overwritten
    ws.write_json("workspace/tender_normalized.json", {"scoring": [], "_sentinel": 1})

    ensure_normalized_tender(ws)

    assert ws.read_json("workspace/tender_normalized.json").get("_sentinel") == 1


def test_normalize_scoring_coerces_bool_must_keep_to_list():
    # Regression: qwen/mimo sometimes emit scoring[].must_keep as a bool flag,
    # which the frozen vendor check_coverage.py would `TypeError` on (it iterates
    # must_keep as keywords). Normalize must coerce non-lists to [].
    out = normalize_scoring(
        {
            "scoring": [
                {"id": "T1", "must_keep": True},
                {"id": "T2", "must_keep": ["守住这句"]},
            ]
        }
    )
    assert out[0]["must_keep"] == []
    assert out[1]["must_keep"] == ["守住这句"]
