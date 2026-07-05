# SPDX-License-Identifier: Apache-2.0
"""Phase-4b lightweight full-text search over the shared materials corpus
(corpus/materials/*.md produced by materials_store). Backend-local, zero new
deps: an in-memory SQLite FTS5 index (trigram tokenizer for CJK) built per
call, BM25-ranked, scope-filtered by reusing materials_store.materials_for.
Scope stays single-sourced in node_briefs.json — never stored here. Phase 4c
wires search/read into the ghostwriter as tools; this module is just the engine."""

from pathlib import Path

from app.services.bid import materials_store
from app.services.bid.workspace import BidWorkspace

_MATERIALS_DIR = materials_store._MATERIALS_DIR  # single source of the path layout


def read(ws: BidWorkspace, name: str, char_range: tuple[int, int] | None = None) -> str:
    """Read one extracted material's text. Traversal-safe (basename only),
    returns '' for unknown/missing files. Optional (start, end) char slice."""
    safe = Path(name).name
    if not safe or safe in (".", ".."):
        return ""
    p = ws.path(materials_store._extracted_path(safe))
    if not p.exists():
        return ""
    text = p.read_text(encoding="utf-8")
    if char_range is not None:
        start, end = char_range
        return text[start:end]
    return text
