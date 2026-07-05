# SPDX-License-Identifier: Apache-2.0
"""Per-project shared materials store: extract attachment text into a shared
corpus so drafting ghostwriters (and, in phase 4b, full-text search) can ground
on bidder materials. This module owns EXTRACTION bookkeeping only — a material's
SCOPE (global / linked-to-nodes) stays single-sourced in node_briefs.json's
MaterialEntry list (see materials_for). Never duplicate scope here."""

from app.services.bid.tender_extract import TenderExtractError, extract_text
from app.services.bid.workspace import BidWorkspace

_ATTACH_DIR = "corpus/attachments"
_MATERIALS_DIR = "corpus/materials"
_MANIFEST = "corpus/materials_manifest.json"


def _extracted_path(name: str) -> str:
    # Mirror the attachment basename with a .md suffix; attachment names are
    # already traversal-stripped by materials_service.save_attachment.
    return f"{_MATERIALS_DIR}/{name}.md"


def read_manifest(ws: BidWorkspace) -> dict:
    p = ws.path(_MANIFEST)
    if not p.exists():
        return {}
    return ws.read_json(_MANIFEST)


def _write_manifest(ws: BidWorkspace, manifest: dict) -> None:
    ws.write_json(_MANIFEST, manifest)


def ingest_attachment(ws: BidWorkspace, name: str) -> dict:
    """Extract one attachment's text into corpus/materials/<name>.md and record
    the outcome in the manifest. Never raises for extraction problems: a scanned
    PDF (no text layer) -> 'empty', an unreadable file -> 'failed'."""
    raw = ws.path(f"{_ATTACH_DIR}/{name}")
    content = raw.read_bytes()
    try:
        text = extract_text(name, content)
    except TenderExtractError:
        text = None
        status = "failed"
    else:
        status = "ok" if (text or "").strip() else "empty"

    chars = len(text or "")
    out_path = ws.path(_extracted_path(name))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text or "", encoding="utf-8")

    manifest = read_manifest(ws)
    manifest[name] = {"status": status, "chars": chars}
    _write_manifest(ws, manifest)
    return {"name": name, "status": status, "chars": chars}


def ingest_all(ws: BidWorkspace) -> dict:
    """Ingest every attachment currently on disk. Returns {name: status}."""
    from app.services.bid import materials_service

    result: dict[str, str] = {}
    for a in materials_service.list_attachments(ws):
        result[a["name"]] = ingest_attachment(ws, a["name"])["status"]
    return result


def _visible(entry: dict, node_id: str) -> bool:
    if entry.get("scope") == "global":
        return True
    return node_id in (entry.get("linkedNodeIds") or [])


def _summary(ws: BidWorkspace, name: str, limit: int = 800) -> str:
    p = ws.path(_extracted_path(name))
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8")[:limit]


def materials_for(ws: BidWorkspace, node_id: str) -> list[dict]:
    """Materials visible to one outline node, per scope, with an extracted-text
    summary for code-anchored injection into the ghostwriter context. Scope is
    read from node_briefs.json's MaterialEntry list (single source); summary is
    read from the extracted corpus (may be empty if ingest hasn't run/failed)."""
    from app.services.bid import materials_service

    entries = materials_service.read_briefs(ws).get("materials", [])
    out: list[dict] = []
    for e in entries:
        if not _visible(e, node_id):
            continue
        name = e.get("name")
        if not name:
            continue
        out.append(
            {
                "name": name,
                "scope": e.get("scope") or "linked",
                "summary": _summary(ws, name),
            }
        )
    return out
