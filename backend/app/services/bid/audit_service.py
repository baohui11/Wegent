# SPDX-License-Identifier: Apache-2.0
"""Phase 6 体检: run the deterministic bid-auditor aggregate (first pass).

run_audit.py exit code encodes verdict (0=pass / 1=high / 2=veto), which is
indistinguishable from a crash exit 1. So success is judged by whether the
report file was written and parses — not by the return code.
"""

import subprocess
import sys
from pathlib import Path

from app.services.bid.parse_pipeline import BidPipelineError
from app.services.bid.workspace import BidWorkspace

_SCRIPT = (
    Path(__file__).parent
    / "vendor"
    / "skills"
    / "bid-auditor"
    / "scripts"
    / "run_audit.py"
)
_REPORT = "workspace/audit_report.json"
_PRICING = "workspace/pricing.json"
_TASKS = "workspace/_fidelity_tasks.json"
_VERDICTS = "workspace/_fidelity_verdicts.json"


def _audit_args(verdicts: bool) -> list[str]:
    args = [
        sys.executable,
        str(_SCRIPT),
        "--tender",
        "workspace/tender.json",
        "--outline",
        "workspace/outline.json",
        "--sections",
        "workspace/sections",
        "--pricing",
        _PRICING,
        "--corpus",
        "corpus/qualifications.json",
        "--knowledge-base",
        "corpus/bidder_knowledge_base.json",
        "--inputs",
        "workspace/tender_segments",
        "--manifest",
        "workspace/tender_manifest.json",
        "--bid-config",
        "corpus/bid_config.json",
        "--tasks-out",
        _TASKS,
        "--out",
        _REPORT,
    ]
    if verdicts:
        args += ["--verdicts", _VERDICTS]
    return args


def _run(ws: BidWorkspace, *, verdicts: bool) -> dict:
    # run_audit requires --pricing; no phase produces it. Empty {} is safe:
    # check_numbers guards every branch on `total is not None`, so it emits no
    # false veto. Business/pricing volume is out of the closed-loop scope.
    if not ws.path(_PRICING).exists():
        ws.write_json(_PRICING, {})
    proc = subprocess.run(
        _audit_args(verdicts),
        cwd=str(ws.dir()),
        capture_output=True,
        text=True,
        timeout=300,
    )
    if not ws.path(_REPORT).exists():
        raise BidPipelineError(f"run_audit failed: {proc.stdout + proc.stderr}")
    return ws.read_json(_REPORT)


def run_audit(ws: BidWorkspace) -> dict:
    return _run(ws, verdicts=False)


def run_audit_verdicts(ws: BidWorkspace) -> dict:
    return _run(ws, verdicts=True)


def read_fidelity_tasks(ws: BidWorkspace) -> list:
    if not ws.path(_TASKS).exists():
        return []
    return ws.read_json(_TASKS).get("tasks", [])


def write_verdicts(ws: BidWorkspace, verdicts: list) -> None:
    ws.write_json(_VERDICTS, {"verdicts": verdicts})


def read_report(ws: BidWorkspace) -> dict | None:
    if not ws.path(_REPORT).exists():
        return None
    return ws.read_json(_REPORT)
