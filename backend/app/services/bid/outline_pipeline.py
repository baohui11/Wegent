# SPDX-License-Identifier: Apache-2.0
"""Phase 2 (规划/大纲) orchestration: build_outline.py -> outline.json."""

import subprocess
import sys
from pathlib import Path

import anyio

from app.services.bid.parse_pipeline import BidPipelineError
from app.services.bid.workspace import BidWorkspace

_SW = Path(__file__).parent / "vendor" / "skills" / "bid-section-writer"
_SCRIPT = _SW / "scripts" / "build_outline.py"
_SKELETON = _SW / "references" / "outline_skeleton.json"
_PROFILE = _SW / "references" / "bidder_outline_profile_ke-gai.json"
_TENDER = "workspace/tender.json"
# Build-only normalized copy; the canonical tender.json is never mutated.
_TENDER_BUILD = "workspace/_tender_build.json"


def _normalize_required_outline(ro):
    """Coerce LLM-produced required_outline into the shape build_outline expects.

    build_front_sections indexes ``item.get("title")`` on each entry, but qwen
    sometimes emits the list items (e.g. front_matter) as bare strings, crashing
    the deterministic build with AttributeError. Wrap string items as
    ``{"title": str}`` so the build cannot fail on partial LLM output.
    """

    def coerce_list(items):
        return [{"title": x} if isinstance(x, str) else x for x in items]

    if isinstance(ro, dict):
        return {k: coerce_list(v) if isinstance(v, list) else v for k, v in ro.items()}
    if isinstance(ro, list):
        return coerce_list(ro)
    return ro


def _prepare_tender(ws: BidWorkspace) -> str:
    """Write a build-only tender copy with normalized required_outline; return path."""
    tender = dict(ws.read_json(_TENDER))
    if "required_outline" in tender:
        tender["required_outline"] = _normalize_required_outline(
            tender["required_outline"]
        )
    ws.write_json(_TENDER_BUILD, tender)
    return _TENDER_BUILD


def run_build_outline(ws: BidWorkspace) -> None:
    tender_path = _prepare_tender(ws)
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
