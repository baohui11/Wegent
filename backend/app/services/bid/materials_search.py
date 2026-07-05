# SPDX-License-Identifier: Apache-2.0
"""Phase-4b lightweight full-text search over the shared materials corpus
(corpus/materials/*.md produced by materials_store). Backend-local, zero new
deps: an in-memory SQLite FTS5 index (trigram tokenizer for CJK) built per
call, BM25-ranked, scope-filtered by reusing materials_store.materials_for.
Scope stays single-sourced in node_briefs.json — never stored here. Phase 4c
wires search/read into the ghostwriter as tools; this module is just the engine."""

import sqlite3
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


_MAX_HITS = 5
_SNIPPET_TOKENS = 12
_TRIGRAM_MIN = 3
_SNIPPET_WINDOW = 60


def _fts_query(q: str) -> str:
    # Wrap the whole query as a quoted string so arbitrary user text (spaces,
    # punctuation, FTS operators) can't break MATCH syntax. Double internal
    # quotes per FTS5 escaping. With the trigram tokenizer this is substring.
    return '"' + q.replace('"', '""') + '"'


def _shape_hit(name: str, snippet: str) -> dict:
    return {
        "material": name,
        "snippet": snippet,
        "source": materials_store._extracted_path(name),
    }


def _substring_search(visible: list[tuple[str, str]], query: str) -> list[dict]:
    """Fallback when the query is shorter than trigram's 3-gram floor or FTS5 is
    unavailable: plain substring scan ordered by occurrence count."""
    scored = []
    for name, text in visible:
        count = text.count(query)
        if count:
            i = text.find(query)
            lo = max(0, i - _SNIPPET_WINDOW // 2)
            snippet = text[lo : lo + _SNIPPET_WINDOW]
            scored.append((count, _shape_hit(name, snippet)))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [hit for _, hit in scored[:_MAX_HITS]]


def _fts_search(visible: list[tuple[str, str]], query: str) -> list[dict]:
    """Build an in-memory FTS5 (trigram) index over the visible (name, text)
    pairs and return BM25-ranked hits. Raises sqlite3.OperationalError if FTS5/
    trigram is unavailable so the caller can fall back."""
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute(
            "CREATE VIRTUAL TABLE m USING fts5(name UNINDEXED, body, tokenize='trigram')"
        )
        conn.executemany("INSERT INTO m(name, body) VALUES (?, ?)", visible)
        rows = conn.execute(
            "SELECT name, snippet(m, 1, '【', '】', '…', ?) FROM m "
            "WHERE m MATCH ? ORDER BY bm25(m) LIMIT ?",
            (_SNIPPET_TOKENS, _fts_query(query), _MAX_HITS),
        ).fetchall()
        return [_shape_hit(name, snip) for name, snip in rows]
    finally:
        conn.close()


def search(ws: BidWorkspace, query: str, node_id: str) -> list[dict]:
    """Full-text search the materials visible to `node_id`, BM25-ranked.
    Returns up to _MAX_HITS [{material, snippet, source}]. Never raises: an
    empty query, no visible materials, or an FTS error yields []."""
    q = (query or "").strip()
    if not q:
        return []
    visible = [
        (m["name"], read(ws, m["name"]))
        for m in materials_store.materials_for(ws, node_id)
    ]
    visible = [(n, t) for n, t in visible if t.strip()]
    if not visible:
        return []
    if len(q) < _TRIGRAM_MIN:
        return _substring_search(visible, q)
    try:
        return _fts_search(visible, q)
    except sqlite3.OperationalError:
        # FTS5/trigram unavailable in this runtime -> degrade, don't crash.
        return _substring_search(visible, q)
