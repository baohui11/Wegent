# SPDX-License-Identifier: Apache-2.0
"""Phase 1 (拆标) orchestration. Task 4 adds run_segment/run_merge (blocking);
Task 6 adds the async parse_tender orchestrator."""

import subprocess
import sys
from pathlib import Path

import anyio

from app.services.bid.specialists import call_tender_sleuth
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


async def _run_segment_async(ws):
    await anyio.to_thread.run_sync(run_segment, ws)


async def _run_merge_async(ws):
    return await anyio.to_thread.run_sync(run_merge, ws)


def _write_parts(ws, parts: dict) -> None:
    for key, content in parts.items():
        ws.write_json(f"workspace/tender_parts/{key}.json", content)


def _read_ctx(ws):
    def _try_json(rel, default):
        try:
            return ws.read_json(rel)
        except FileNotFoundError:
            return default

    return dict(
        manifest=_try_json("workspace/tender_manifest.json", {}),
        segments=ws.read_text_files("workspace/tender_segments"),
        regions=ws.read_text_files("workspace/tender_regions"),
        veto=_try_json("workspace/veto_candidates.json", {}),
        bid_config=_try_json("corpus/bid_config.json", {}),
    )


async def parse_tender(ws, *, model: str, model_config: dict | None) -> dict:
    await _run_segment_async(ws)
    ctx = _read_ctx(ws)
    parts = await call_tender_sleuth(model=model, model_config=model_config, **ctx)
    _write_parts(ws, parts)
    code, output = await _run_merge_async(ws)
    if code != 0:
        # In-phase single retry: feed merge_issues back to the specialist, re-merge.
        issues = (
            ws.read_json("workspace/tender.json")
            .get("_meta", {})
            .get("merge_issues", [])
        )
        retry_parts = await call_tender_sleuth(
            model=model,
            model_config=model_config,
            **{**ctx, "bid_config": {**ctx["bid_config"], "_merge_issues": issues}},
        )
        _write_parts(ws, retry_parts)
        code, output = await _run_merge_async(ws)
        if code != 0:
            issues = (
                ws.read_json("workspace/tender.json")
                .get("_meta", {})
                .get("merge_issues", [])
            )
            raise BidPipelineError(f"merge failed after retry: {issues or output}")
    return ws.read_json("workspace/tender.json")
