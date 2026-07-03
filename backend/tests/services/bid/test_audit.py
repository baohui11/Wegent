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
