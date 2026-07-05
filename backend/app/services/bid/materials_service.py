# SPDX-License-Identifier: Apache-2.0
"""Bidder materials (corpus) management: knowledge base, qualifications,
attachment files. Everything lives under the project workspace `corpus/`."""

from pathlib import Path

from app.services.bid.workspace import BidWorkspace

_KB = "corpus/bidder_knowledge_base.json"
_QUALS = "corpus/qualifications.json"
_BRIEFS = "corpus/node_briefs.json"
_ATTACH_DIR = "corpus/attachments"

# Canonical enumeration of NodeBrief fields — MUST mirror the frontend NodeBrief
# type (requirements/emphasis/wordMin-wordMax/needFigure/importance). Both drafting
# prompts (parallel full draft + single-section redraft) reference this so the two
# paths describe the brief identically.
NODE_BRIEF_FIELDS_ZH = (
    "具体要求 requirements、重点 emphasis、字数 wordMin-wordMax、"
    "是否配图 needFigure、重要性 importance"
)


def read_knowledge_base(ws: BidWorkspace) -> dict:
    p = ws.path(_KB)
    if not p.exists():
        raise FileNotFoundError(_KB)
    return ws.read_json(_KB)


def write_knowledge_base(ws: BidWorkspace, doc: dict) -> None:
    if not isinstance(doc.get("bidder_knowledge_base"), dict):
        raise ValueError(
            "knowledge base must have a top-level 'bidder_knowledge_base' object"
        )
    ws.write_json(_KB, doc)


def read_qualifications(ws: BidWorkspace) -> dict:
    p = ws.path(_QUALS)
    if not p.exists():
        raise FileNotFoundError(_QUALS)
    return ws.read_json(_QUALS)


def write_qualifications(ws: BidWorkspace, doc: dict) -> None:
    # The vendored resolve_quals.py / check_checklist.py consume ``items`` as a
    # LIST of {id, name, expiry, file} objects; keep the stored shape aligned.
    if not isinstance(doc.get("items"), list):
        raise ValueError("qualifications must have a top-level 'items' list")
    ws.write_json(_QUALS, doc)


def save_attachment(ws: BidWorkspace, filename: str, content: bytes) -> dict:
    name = Path(filename).name  # strip any directory components (traversal-safe)
    if not name or name in (".", ".."):
        raise ValueError("invalid attachment filename")
    target = ws.path(f"{_ATTACH_DIR}/{name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return {"name": name, "size": len(content)}


def list_attachments(ws: BidWorkspace) -> list[dict]:
    d = ws.path(_ATTACH_DIR)
    if not d.is_dir():
        return []
    return [
        {"name": f.name, "size": f.stat().st_size}
        for f in sorted(d.iterdir())
        if f.is_file()
    ]


def read_briefs(ws: BidWorkspace) -> dict:
    """Per-outline-node writing briefs + material links (stage-2 UI state).

    Missing file means "nothing configured yet" -> empty doc, not an error.
    """
    p = ws.path(_BRIEFS)
    if not p.exists():
        return {"briefs": {}, "materials": []}
    return ws.read_json(_BRIEFS)


def write_briefs(ws: BidWorkspace, doc: dict) -> None:
    briefs = doc.get("briefs")
    materials = doc.get("materials", [])
    if not isinstance(briefs, dict) or not all(
        isinstance(v, dict) for v in briefs.values()
    ):
        raise ValueError("briefs must be an object mapping node id -> object")
    if not isinstance(materials, list) or not all(
        isinstance(m, dict) for m in materials
    ):
        raise ValueError("materials must be a list of objects")
    ws.write_json(_BRIEFS, {"briefs": briefs, "materials": materials})


def reconcile_briefs(ws: BidWorkspace, doc: dict) -> dict:
    """Drop material entries whose backing file no longer exists on disk.

    Read-time alignment only (does not rewrite): keeps the returned view honest;
    the next explicit save persists the cleanup."""
    present = {a["name"] for a in list_attachments(ws)}
    mats = [m for m in doc.get("materials", []) if m.get("name") in present]
    return {"briefs": doc.get("briefs", {}), "materials": mats}
