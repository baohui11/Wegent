# SPDX-License-Identifier: Apache-2.0
"""Phase 1 (拆标) orchestration. Task 4 adds run_segment/run_merge (blocking);
Task 6 adds the async parse_tender orchestrator."""

import asyncio
import logging
import subprocess
import sys
from pathlib import Path

import anyio

from app.services.bid.project_service import (
    DEFAULT_PROJECT_TITLE,
    BidProjectService,
)
from app.services.bid.specialists import call_tender_sleuth
from app.services.bid.workspace import BidWorkspace

logger = logging.getLogger(__name__)

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


# Hard-required top-level blocks (mirrors merge_tender.py REQUIRED_BLOCKS).
_REQUIRED_BLOCKS = [
    "project",
    "qualifications",
    "scoring",
    "mandatory_clauses",
    "submission_rules",
    "required_outline",
    "requirements",
    "commitment_terms",
    "target_package",
]


def _write_parts(ws, parts: dict) -> None:
    # merge_tender.py iterates each part file with ``data.items()``; it must be a
    # ``{block: value}`` dict. call_tender_sleuth returns bare block values (some
    # are lists, e.g. scoring), so re-wrap under the block key.
    for key, content in parts.items():
        ws.write_json(f"workspace/tender_parts/{key}.json", {key: content})


def _tender_complete(ws) -> bool:
    # merge_tender.py always writes tender.json (even with advisory
    # _meta.merge_issues) and exits non-zero on ANY issue, including soft
    # closure warnings. Accept the parse once every REQUIRED_BLOCK is present;
    # advisory quality issues are surfaced later in coverage/audit and reviewed
    # by the human (segment-internal auto, segment-boundary manual).
    try:
        tender = ws.read_json("workspace/tender.json")
    except FileNotFoundError:
        return False
    return all(b in tender for b in _REQUIRED_BLOCKS)


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


def _merge_issues(ws) -> list:
    # merge_tender.py may not write tender.json on a hard failure; degrade to []
    # so the caller reports the merge stderr instead of crashing with 500.
    try:
        return (
            ws.read_json("workspace/tender.json")
            .get("_meta", {})
            .get("merge_issues", [])
        )
    except FileNotFoundError:
        return []


async def parse_tender(ws, *, model: str, model_config: dict | None) -> dict:
    await _run_segment_async(ws)
    ctx = _read_ctx(ws)
    parts = await call_tender_sleuth(model=model, model_config=model_config, **ctx)
    _write_parts(ws, parts)
    _, output = await _run_merge_async(ws)
    if not _tender_complete(ws):
        # In-phase single retry: feed merge_issues back to the specialist, re-merge.
        issues = _merge_issues(ws)
        retry_parts = await call_tender_sleuth(
            model=model,
            model_config=model_config,
            **{**ctx, "bid_config": {**ctx["bid_config"], "_merge_issues": issues}},
        )
        _write_parts(ws, retry_parts)
        _, output = await _run_merge_async(ws)
        if not _tender_complete(ws):
            raise BidPipelineError(
                f"merge failed after retry: {_merge_issues(ws) or output}"
            )
    return ws.read_json("workspace/tender.json")


async def _run_parse(
    project_id: int, user_id: int, model: str, model_config: dict | None
) -> None:
    # Background 拆标 (mirrors _run_drafting): the LLM pipeline is minutes-long,
    # so run it off the request. Owns its own DB session.
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        project = BidProjectService.get(db, user_id=user_id, project_id=project_id)
        if project is None:
            return
        ws = BidWorkspace(project.workspace_ref)
        try:
            tender = await parse_tender(ws, model=model, model_config=model_config)
            derived = ((tender.get("project") or {}).get("name") or "").strip()
            # Preserve a user-chosen title; only fall back to the tender-derived
            # name when the project still carries the smart-naming placeholder.
            current = (project.title or "").strip()
            keep_user_title = bool(current) and current != DEFAULT_PROJECT_TITLE
            title = None if keep_user_title else (derived or None)
            BidProjectService.complete_phase1(db, project=project, title=title)
        except Exception as e:  # never leave the project stuck in 'parsing'
            logger.warning("parse failed for project %s: %s", project_id, e)
            project.status = "parse_failed"
            db.commit()
    finally:
        db.close()


def launch_parse(
    project_id: int, user_id: int, model: str, model_config: dict | None
) -> None:
    asyncio.create_task(_run_parse(project_id, user_id, model, model_config))
