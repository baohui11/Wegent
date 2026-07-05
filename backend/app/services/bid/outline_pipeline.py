# SPDX-License-Identifier: Apache-2.0
"""Phase 2 (规划/大纲) orchestration: build_outline.py -> outline.json."""

import subprocess
import sys
from pathlib import Path

import anyio

from app.services.bid.parse_pipeline import BidPipelineError
from app.services.bid.tender_normalize import ensure_normalized_tender
from app.services.bid.workspace import BidWorkspace

_SW = Path(__file__).parent / "vendor" / "skills" / "bid-section-writer"
_SCRIPT = _SW / "scripts" / "build_outline.py"
_SKELETON = _SW / "references" / "outline_skeleton.json"
_PROFILE = _SW / "references" / "bidder_outline_profile_ke-gai.json"


def run_build_outline(ws: BidWorkspace) -> None:
    tender_path = ensure_normalized_tender(ws)
    args = [
        sys.executable,
        str(_SCRIPT),
        "--tender",
        tender_path,
        "--skeleton",
        str(_SKELETON),
        "--profile",
        str(_PROFILE),
        "--out",
        "workspace/outline.json",
        "--sections-out",
        "workspace/sections",
    ]
    kb = ws.path("corpus/bidder_knowledge_base.json")
    if kb.exists():
        args += ["--knowledge-base", "corpus/bidder_knowledge_base.json"]
    proc = subprocess.run(
        args, cwd=str(ws.dir()), capture_output=True, text=True, timeout=180
    )
    if proc.returncode != 0:
        raise BidPipelineError(f"build_outline failed: {proc.stdout + proc.stderr}")


async def build_outline_for_project(ws: BidWorkspace) -> dict:
    await anyio.to_thread.run_sync(run_build_outline, ws)
    return ws.read_json("workspace/outline.json")
