# SPDX-License-Identifier: Apache-2.0
"""Section review state (accepted flags) for phase 5."""

from app.services.bid.workspace import BidWorkspace

_REVIEW = "workspace/_review_status.json"


def read_review(ws: BidWorkspace) -> dict:
    p = ws.path(_REVIEW)
    if not p.exists():
        return {"accepted": {}}
    return ws.read_json(_REVIEW)


def mark_accepted(ws: BidWorkspace, section_id: str) -> None:
    st = read_review(ws)
    st.setdefault("accepted", {})[section_id] = True
    ws.write_json(_REVIEW, st)


def clear_accepted(ws: BidWorkspace, section_id: str) -> None:
    """Drop the accepted flag for a section (editing invalidates prior review)."""
    st = read_review(ws)
    st.get("accepted", {}).pop(section_id, None)
    ws.write_json(_REVIEW, st)
