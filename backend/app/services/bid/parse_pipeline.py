# SPDX-License-Identifier: Apache-2.0
"""Phase 1 (拆标) orchestration. Task 4 adds run_segment/run_merge (blocking);
Task 6 adds the async parse_tender orchestrator."""

import subprocess
import sys
from pathlib import Path

from app.services.bid.workspace import BidWorkspace

_SCRIPTS = Path(__file__).parent / "vendor" / "skills" / "tender-parser" / "scripts"


class BidPipelineError(Exception):
    pass


def run_segment(ws: BidWorkspace) -> None:
    proc = subprocess.run(
        [
            sys.executable,
            str(_SCRIPTS / "segment_tender.py"),
            "--inputs",
            "inputs/final",
            "--out",
            "workspace",
        ],
        cwd=str(ws.dir()),
        capture_output=True,
        text=True,
        timeout=300,
    )
    if proc.returncode != 0:
        raise BidPipelineError(f"segment_tender failed: {proc.stderr}")


def run_merge(ws: BidWorkspace) -> tuple[int, str]:
    proc = subprocess.run(
        [
            sys.executable,
            str(_SCRIPTS / "merge_tender.py"),
            "--parts",
            "workspace/tender_parts",
            "--out",
            "workspace/tender.json",
        ],
        cwd=str(ws.dir()),
        capture_output=True,
        text=True,
        timeout=120,
    )
    return proc.returncode, (proc.stdout + proc.stderr)
