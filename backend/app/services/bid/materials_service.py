# SPDX-License-Identifier: Apache-2.0
"""Bidder materials (corpus) management: knowledge base, qualifications,
attachment files. Everything lives under the project workspace `corpus/`."""

from pathlib import Path

from app.services.bid.workspace import BidWorkspace

_KB = "corpus/bidder_knowledge_base.json"
_QUALS = "corpus/qualifications.json"
_ATTACH_DIR = "corpus/attachments"


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
    if not isinstance(doc.get("items"), dict):
        raise ValueError("qualifications must have a top-level 'items' object")
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
