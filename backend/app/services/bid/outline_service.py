# SPDX-License-Identifier: Apache-2.0
"""Read/write the outline blackboard file and the package declaration."""

from app.services.bid.workspace import BidWorkspace

_OUTLINE = "workspace/outline.json"


def read_outline(ws: BidWorkspace) -> dict:
    p = ws.path(_OUTLINE)
    if not p.exists():
        raise FileNotFoundError(_OUTLINE)
    return ws.read_json(_OUTLINE)


def write_outline(ws: BidWorkspace, outline: dict) -> None:
    if not isinstance(outline.get("sections"), list):
        raise ValueError("outline must contain a 'sections' list")
    ws.write_json(_OUTLINE, outline)


def write_bid_config(ws: BidWorkspace, package: str) -> None:
    # Written before 拆标 so the specialist locks onto the declared package
    # (multi-package tenders otherwise block, per team hard constraint).
    ws.write_json("corpus/bid_config.json", {"package": package})
