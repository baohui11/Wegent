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


async def parse_tender(
    ws,
    *,
    model: str,
    model_config: dict | None,
    project_id: int | None = None,
    user_id: int | None = None,
) -> dict:
    set_parse_stage(ws, "segmenting")
    await _run_segment_async(ws)
    set_parse_stage(ws, "extracting")
    ctx = _read_ctx(ws)
    parts = await call_tender_sleuth(
        model=model,
        model_config=model_config,
        project_id=project_id,
        user_id=user_id,
        **ctx,
    )
    _write_parts(ws, parts)
    set_parse_stage(ws, "merging")
    _, output = await _run_merge_async(ws)
    if not _tender_complete(ws):
        # In-phase single retry: feed merge_issues back to the specialist, re-merge.
        issues = _merge_issues(ws)
        retry_parts = await call_tender_sleuth(
            model=model,
            model_config=model_config,
            project_id=project_id,
            user_id=user_id,
            **{**ctx, "bid_config": {**ctx["bid_config"], "_merge_issues": issues}},
        )
        _write_parts(ws, retry_parts)
        _, output = await _run_merge_async(ws)
        if not _tender_complete(ws):
            raise BidPipelineError(
                f"merge failed after retry: {_merge_issues(ws) or output}"
            )
    return ws.read_json("workspace/tender.json")


_PARSE_STAGE_FILE = "workspace/_parse_stage.json"


def set_parse_stage(ws: BidWorkspace, stage: str) -> None:
    """Write the current coarse parse stage so the frontend can show real
    progress (segmenting → extracting → merging → building_outline → done)
    instead of a fake spinner."""
    try:
        ws.write_json(_PARSE_STAGE_FILE, {"stage": stage})
    except Exception:
        logger.warning("failed to write parse stage %s", stage, exc_info=True)


def read_parse_stage(ws: BidWorkspace) -> str:
    """Read the current parse stage; 'idle' when no parse has run yet."""
    try:
        return ws.read_json(_PARSE_STAGE_FILE).get("stage", "idle")
    except Exception:
        return "idle"


def _prefill_qualifications(ws: BidWorkspace, tender: dict) -> None:
    """Seed corpus/qualifications.json from the parsed tender so the audit
    checklist and {{qual:ID}} binding have data without manual JSON editing.
    Never overwrites an existing file (user edits win). Company stays empty
    until the stage-2 bidder-info card fills it."""
    from app.services.bid import materials_service
    from app.services.bid.tender_normalize import normalize_qualifications

    if ws.path("corpus/qualifications.json").exists():
        return
    raw = normalize_qualifications(tender.get("qualifications"))
    items = []
    for i, q in enumerate(raw if isinstance(raw, list) else [], start=1):
        if not isinstance(q, dict):
            continue
        name = str(q.get("name") or q.get("desc") or q.get("type") or "").strip()
        if not name:
            continue
        items.append({"id": str(q.get("id") or f"Q{i}"), "name": name})
    materials_service.write_qualifications(ws, {"company": "", "items": items})


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
            tender = await parse_tender(
                ws,
                model=model,
                model_config=model_config,
                project_id=project_id,
                user_id=user_id,
            )
            try:
                _prefill_qualifications(ws, tender)
            except Exception:
                # Prefill is best-effort seeding; it must never fail the parse.
                logger.warning(
                    "qualifications prefill failed for project %s",
                    project_id,
                    exc_info=True,
                )
            try:
                from app.services.bid.tender_normalize import normalized_tender

                ws.write_json(
                    "workspace/tender_normalized.json", normalized_tender(tender)
                )
            except Exception:
                logger.warning(
                    "tender normalization failed for project %s",
                    project_id,
                    exc_info=True,
                )
            derived = ((tender.get("project") or {}).get("name") or "").strip()
            # Preserve a user-chosen title; only fall back to the tender-derived
            # name when the project still carries the smart-naming placeholder.
            current = (project.title or "").strip()
            keep_user_title = bool(current) and current != DEFAULT_PROJECT_TITLE
            title = None if keep_user_title else (derived or None)
            BidProjectService.complete_phase1(db, project=project, title=title)
            # Auto-build the outline so the user lands on a populated canvas
            # right after parsing (no manual "build outline" step needed).
            set_parse_stage(ws, "building_outline")
            try:
                from app.services.bid.outline_pipeline import build_outline_for_project

                await build_outline_for_project(ws)
            except Exception:
                logger.warning(
                    "auto build_outline failed for project %s",
                    project_id,
                    exc_info=True,
                )
            set_parse_stage(ws, "done")
        except Exception as e:  # never leave the project stuck in 'parsing'
            logger.warning("parse failed for project %s: %s", project_id, e)
            project.status = "parse_failed"
            db.commit()
            set_parse_stage(ws, "failed")
    finally:
        db.close()


def launch_parse(
    project_id: int, user_id: int, model: str, model_config: dict | None
) -> None:
    asyncio.create_task(_run_parse(project_id, user_id, model, model_config))
