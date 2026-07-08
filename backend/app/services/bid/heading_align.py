# SPDX-License-Identifier: Apache-2.0
"""Stage-3 source-alignment: make the drafted body's headings match the outline
leaves one-for-one. Pure text helpers (no workspace IO) — the ghostwriter prompt
asks the LLM to emit each leaf title as a ``##`` heading, and this module is the
deterministic backstop that appends a placeholder heading for any the LLM
omitted, so the outline↔body mapping never breaks (spec §6/§9)."""

import re

_HEADING_RE = re.compile(r"^#{2,6}\s+(.+?)\s*$", re.MULTILINE)
_PLACEHOLDER = "待填（来源：..）"


def leaf_titles(node: dict) -> list[str]:
    """Titles of the chapter's leaves (nodes with no non-empty children), DFS
    document order. A childless chapter returns ``[]`` (drafts as free prose)."""
    out: list[str] = []

    def walk(nodes: list) -> None:
        for n in nodes:
            kids = n.get("children") or []
            if kids:
                walk(kids)
            else:
                t = str(n.get("title") or "").strip()
                if t:
                    out.append(t)

    walk(node.get("children") or [])
    return out


def body_headings(text: str) -> list[str]:
    """All ``##``–``######`` heading texts in the body (stripped)."""
    return [m.group(1).strip() for m in _HEADING_RE.finditer(text)]


def missing_leaf_headings(node: dict, text: str) -> list[str]:
    """Leaf titles that do not appear as a body heading (exact, stripped match)."""
    present = set(body_headings(text))
    return [t for t in leaf_titles(node) if t not in present]


def align_leaf_headings(node: dict, text: str) -> tuple[str, list[str]]:
    """Append ``## <title>\\n\\n待填（来源：..）`` for every missing leaf. Returns
    ``(new_text, appended_titles)``; a no-op ``(text, [])`` when none are missing."""
    missing = missing_leaf_headings(node, text)
    if not missing:
        return text, []
    blocks = [f"## {t}\n\n{_PLACEHOLDER}" for t in missing]
    return text.rstrip() + "\n\n" + "\n\n".join(blocks) + "\n", missing
