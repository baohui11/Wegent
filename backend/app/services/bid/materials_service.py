# SPDX-License-Identifier: Apache-2.0
"""Bidder materials (corpus) management: knowledge base, qualifications,
attachment files. Everything lives under the project workspace `corpus/`."""

from app.services.bid.workspace import BidWorkspace

_KB = "corpus/bidder_knowledge_base.json"
_QUALS = "corpus/qualifications.json"


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
