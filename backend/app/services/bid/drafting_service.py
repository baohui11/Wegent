# SPDX-License-Identifier: Apache-2.0
"""Drafting progress (blackboard file) + section read/list for phase 4."""

import hashlib

from app.services.bid.workspace import BidWorkspace

_STATUS = "workspace/_drafting_status.json"
_SECTIONS = "workspace/sections"


def init_status(ws: BidWorkspace, section_ids: list[str]) -> None:
    ws.write_json(
        _STATUS,
        {
            "total": len(section_ids),
            "sections": {sid: "pending" for sid in section_ids},
            "finished": False,
            "error": None,
        },
    )


def read_status(ws: BidWorkspace) -> dict:
    p = ws.path(_STATUS)
    if not p.exists():
        return {
            "total": 0,
            "sections": {},
            "finished": False,
            "error": None,
        }
    return ws.read_json(_STATUS)


def set_section_status(ws: BidWorkspace, section_id: str, status: str) -> None:
    st = read_status(ws)
    st["sections"][section_id] = status
    ws.write_json(_STATUS, st)


def mark_finished(ws: BidWorkspace, error: str | None = None) -> None:
    st = read_status(ws)
    st["finished"] = True
    st["error"] = error
    ws.write_json(_STATUS, st)


def list_section_files(ws: BidWorkspace) -> list[str]:
    d = ws.path(_SECTIONS)
    if not d.is_dir():
        return []
    return [f.stem for f in sorted(d.iterdir()) if f.is_file() and f.suffix == ".md"]


def read_section(ws: BidWorkspace, section_id: str) -> str:
    p = ws.path(f"{_SECTIONS}/{section_id}.md")
    if not p.exists():
        raise FileNotFoundError(section_id)
    return p.read_text(encoding="utf-8")


def write_section(ws: BidWorkspace, section_id: str, content: str) -> None:
    """Write a section's markdown body back to disk (human edit / range redraft)."""
    p = ws.path(f"{_SECTIONS}/{section_id}.md")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def section_version(ws: BidWorkspace, section_id: str) -> str:
    """Content-hash version of a section file (sha256 of its UTF-8 bytes).

    Used as an optimistic-lock token for save / range-redraft. Empty string
    when the section has not been drafted yet.
    """
    p = ws.path(f"{_SECTIONS}/{section_id}.md")
    if not p.exists():
        return ""
    return hashlib.sha256(p.read_bytes()).hexdigest()
