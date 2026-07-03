# SPDX-License-Identifier: Apache-2.0
"""Phase 6 装订: resolve_quals (placeholder -> final) then assemble_bid -> docx.

resolve_quals is the authoritative placeholder hard gate: a non-zero exit means
a dangling/expired qualification or a residual {{...}}, and must abort finalize.
Both steps are deterministic subprocess calls (seconds, not LLM) — no background
task needed.
"""

import subprocess
import sys
from pathlib import Path

from app.services.bid.parse_pipeline import BidPipelineError
from app.services.bid.workspace import BidWorkspace

_SKILLS = Path(__file__).parent / "vendor" / "skills"
_RESOLVE = _SKILLS / "qualification-binder" / "scripts" / "resolve_quals.py"
_ASSEMBLE = _SKILLS / "bid-assembler" / "scripts" / "assemble_bid.py"

DOCX_REL = "workspace/投标文件.docx"


def finalize(ws: BidWorkspace) -> Path:
    resolve = subprocess.run(
        [
            sys.executable,
            str(_RESOLVE),
            "--sections",
            "workspace/sections",
            "--corpus",
            "corpus/qualifications.json",
            "--tender",
            "workspace/tender.json",
            "--out-sections",
            "workspace/final",
            "--attachments",
            "workspace/attachments.md",
        ],
        cwd=str(ws.dir()),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if resolve.returncode != 0:
        # stdout carries the {ok:false, issues:[...]} gate report
        raise BidPipelineError(
            f"resolve_quals failed: {resolve.stdout or resolve.stderr}"
        )

    build = subprocess.run(
        [
            sys.executable,
            str(_ASSEMBLE),
            "--final",
            "workspace/final",
            "--outline",
            "workspace/outline.json",
            "--tender",
            "workspace/tender.json",
            "--attachments",
            "workspace/attachments.json",
            "--root",
            ".",
            "--out",
            DOCX_REL,
        ],
        cwd=str(ws.dir()),
        capture_output=True,
        text=True,
        timeout=180,
    )
    if build.returncode != 0:
        raise BidPipelineError(f"assemble_bid failed: {build.stderr or build.stdout}")
    return ws.path(DOCX_REL)
