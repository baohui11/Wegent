# SPDX-License-Identifier: Apache-2.0
"""Stage-3 (生成与优化) outline: a second outline file the generate/refine phase
reads and edits, kept separate from the stage-1/2 ``outline.json`` so editing the
drafting outline never pollutes the canvas outline. Lazily initialized from
``outline.json`` (mirrors ``tender_normalize.ensure_normalized_tender``)."""

from app.services.bid.outline_service import read_outline
from app.services.bid.workspace import BidWorkspace

_STAGE3 = "workspace/outline_stage3.json"


def ensure_stage3_outline(ws: BidWorkspace) -> str:
    """Return the workspace-relative path to the stage-3 outline, copying it from
    ``outline.json`` when absent. Idempotent; ``outline.json`` is never mutated.
    Raises ``FileNotFoundError`` (from ``read_outline``) when no stage-1 outline
    exists yet."""
    if not ws.path(_STAGE3).exists():
        ws.write_json(_STAGE3, read_outline(ws))
    return _STAGE3


def read_stage3_outline(ws: BidWorkspace) -> dict:
    """Ensure the stage-3 outline exists (init from ``outline.json``) then read it."""
    ensure_stage3_outline(ws)
    return ws.read_json(_STAGE3)


def write_stage3_outline(ws: BidWorkspace, outline: dict) -> None:
    """Persist the stage-3 outline. Same shape guard as ``write_outline``."""
    if not isinstance(outline.get("sections"), list):
        raise ValueError("outline must contain a 'sections' list")
    ws.write_json(_STAGE3, outline)


def differs_from_stage1(ws: BidWorkspace) -> bool:
    """True when the stage-3 outline no longer equals the stage-1 ``outline.json``
    (an edit was made in stage 3, or stage 1 changed since stage 3 was derived).
    Content comparison subsumes a sha-derivation check and needs no meta file.
    False when no stage-1 outline exists (nothing to diverge from)."""
    try:
        stage1 = read_outline(ws)
    except FileNotFoundError:
        return False
    return read_stage3_outline(ws) != stage1
