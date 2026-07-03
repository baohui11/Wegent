# SPDX-License-Identifier: Apache-2.0
from app.services.bid import audit_service as audit
from app.services.bid.workspace import BidWorkspace


def _seed(ws: BidWorkspace) -> None:
    ws.write_json(
        "workspace/tender.json",
        {
            "project": {
                "name": "某信息化项目",
                "id": "ZB-1",
                "budget": "1000000",
                "bid_deadline": "2026-12-31T17:00:00",
            },
            "submission_rules": {"blind_bid": False},
        },
    )
    ws.write_json(
        "workspace/outline.json",
        {"sections": [{"id": "s1", "title": "方案", "covers": []}]},
    )
    ws.path("workspace/sections").mkdir(parents=True, exist_ok=True)
    ws.path("workspace/sections/s1.md").write_text("# 方案\n\n正文。", encoding="utf-8")
    ws.write_json("corpus/qualifications.json", {"company": "测试公司", "items": []})


def test_run_audit_creates_pricing_stub_and_report(tmp_path):
    ws = BidWorkspace("aud1", root=tmp_path)
    _seed(ws)
    assert not ws.path("workspace/pricing.json").exists()
    report = audit.run_audit(ws)
    # pricing stub auto-created (run_audit requires --pricing; empty {} is safe)
    assert ws.path("workspace/pricing.json").exists()
    # report shape from vendored run_audit.py
    assert report["verdict"] in ("PASS", "NEED_FIX", "NEED_FIX_VETO")
    assert "checks" in report and "summary" in report
    assert ws.path("workspace/audit_report.json").exists()


def _seed_with_scoring(ws: BidWorkspace, scoring) -> None:
    _seed(ws)
    tender = ws.read_json("workspace/tender.json")
    tender["scoring"] = scoring
    ws.write_json("workspace/tender.json", tender)


def test_normalize_scoring_unwraps_dict_and_fills_missing_keys():
    tender = {
        "scoring": {
            "weights": {"tech": 70, "price": 30},
            "items": [
                {"code": "T1", "item": "总体方案", "score": 20, "category": "tech"},
                {"code": "B1", "item": "报价", "score": 30, "category": "price"},
            ],
        }
    }
    out = audit._normalize_scoring(tender)
    assert isinstance(out, list) and len(out) == 2
    assert out[0]["id"] == "T1"
    assert out[0]["weight"] == 20
    assert out[0]["category"] == "tech"
    assert out[0]["item"] == "总体方案"
    # price synonym mapped to 价格 so check_coverage excludes it from the total
    assert out[1]["category"] == "价格"


def test_normalize_scoring_fills_id_and_defaults_when_absent():
    out = audit._normalize_scoring({"scoring": [{"score": 10}]})
    assert out[0]["id"] == "S1"
    assert out[0]["weight"] == 10
    assert out[0]["category"] == "技术"
    assert out[0]["item"] == "S1"


def test_normalize_scoring_handles_missing_or_nonlist():
    assert audit._normalize_scoring({}) == []
    assert audit._normalize_scoring({"scoring": None}) == []
    assert audit._normalize_scoring({"scoring": ["oops", 3]}) == []


def test_run_audit_survives_dict_form_scoring(tmp_path):
    # qwen sometimes emits scoring as {"weights", "items"} instead of a list;
    # check_coverage iterates it as a list and would AttributeError. Bug #8.
    ws = BidWorkspace("audsc1", root=tmp_path)
    _seed_with_scoring(
        ws,
        {
            "weights": {"tech": 70, "price": 30},
            "items": [
                {
                    "code": "T1",
                    "item": "方案",
                    "score": 20,
                    "category": "tech",
                    "must_keep": [],
                }
            ],
        },
    )
    report = audit.run_audit(ws)
    assert report["verdict"] in ("PASS", "NEED_FIX", "NEED_FIX_VETO")


def test_run_audit_survives_scoring_missing_id_and_weight(tmp_path):
    # list form but items lack id/weight (qwen uses code/score) → KeyError. Bug #8.
    ws = BidWorkspace("audsc2", root=tmp_path)
    _seed_with_scoring(
        ws,
        [
            {
                "code": "T1",
                "item": "方案",
                "score": 20,
                "category": "技术",
                "must_keep": [],
            }
        ],
    )
    report = audit.run_audit(ws)
    assert report["verdict"] in ("PASS", "NEED_FIX", "NEED_FIX_VETO")


def test_read_report_none_then_value(tmp_path):
    ws = BidWorkspace("aud2", root=tmp_path)
    assert audit.read_report(ws) is None
    _seed(ws)
    audit.run_audit(ws)
    assert audit.read_report(ws)["verdict"] in ("PASS", "NEED_FIX", "NEED_FIX_VETO")


def test_read_fidelity_tasks(tmp_path):
    ws = BidWorkspace("fv1", root=tmp_path)
    assert audit.read_fidelity_tasks(ws) == []
    ws.write_json(
        "workspace/_fidelity_tasks.json",
        {"stage": "audit", "tasks": [{"id": "SF-0"}]},
    )
    assert audit.read_fidelity_tasks(ws) == [{"id": "SF-0"}]


def test_write_verdicts_and_rerun_with_verdicts(tmp_path):
    ws = BidWorkspace("fv2", root=tmp_path)
    _seed(ws)  # tender/outline/sections/qualifications from Plan 11 test helper
    audit.write_verdicts(
        ws,
        [{"id": "SF-0", "verdict": "uncertain", "reason": "x", "severity": "medium"}],
    )
    assert ws.path("workspace/_fidelity_verdicts.json").exists()
    report = audit.run_audit_verdicts(ws)
    assert report["verdict"] in ("PASS", "NEED_FIX", "NEED_FIX_VETO")
    assert "checks" in report
