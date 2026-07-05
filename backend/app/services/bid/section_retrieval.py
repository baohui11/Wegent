# SPDX-License-Identifier: Apache-2.0
"""Phase-4c code-driven retrieval augmentation (route C). Before drafting a
section, code derives short queries from the section's title / brief emphasis /
must_keep and pulls the top-N most relevant material snippets via the 4b FTS5
engine — REPLACING 4a's blanket per-material summary injection so the injected
context is bounded by N (importance-tiered), not by corpus size. No LLM tool
loop (Chat Shell's client endpoint can't surface tool calls; see 4c probe)."""

from app.services.bid import materials_search, materials_store
from app.services.bid.workspace import BidWorkspace

# Injected-material budget per importance tier (bounds context regardless of
# how many materials exist). High-value "money" sections get a bit more.
_RETRIEVAL_BUDGET = {"高": 8, "中": 5, "低": 3}
_DEFAULT_BUDGET = 5


def _budget(brief: dict | None) -> int:
    return _RETRIEVAL_BUDGET.get((brief or {}).get("importance"), _DEFAULT_BUDGET)


def _queries(node: dict, brief: dict | None) -> list[str]:
    """Short, topical queries suited to FTS5 trigram substring matching:
    section title, brief emphasis, and a couple of must_keep phrases."""
    cands = [node.get("title"), (brief or {}).get("emphasis")]
    cands += (node.get("must_keep") or [])[:2]
    out: list[str] = []
    for c in cands:
        s = (c or "").strip()
        if s and s not in out:
            out.append(s)
    return out


def retrieve_for_section(
    ws: BidWorkspace, node: dict, brief: dict | None
) -> list[dict]:
    """Top-N scope-visible material snippets most relevant to this section, for
    code-anchored injection into the ghostwriter (same {name, scope, summary}
    shape call_ghostwriter already consumes; summary is the search snippet).
    Falls back to bounded blanket scope summaries when search finds nothing.
    Never raises."""
    node_id = str(node.get("id"))
    k = _budget(brief)
    scoped = materials_store.materials_for(ws, node_id)  # scope source + fallback
    scope_of = {m["name"]: m.get("scope") or "linked" for m in scoped}

    picked: dict[str, dict] = {}
    for q in _queries(node, brief):
        if len(picked) >= k:
            break
        for hit in materials_search.search(ws, q, node_id):
            name = hit["material"]
            if name not in picked:
                picked[name] = {
                    "name": name,
                    "scope": scope_of.get(name, "linked"),
                    "summary": hit["snippet"],
                }
                if len(picked) >= k:
                    break
    if not picked:
        # Search unproductive -> bounded blanket summaries (also caps the 4a
        # path that would otherwise grow with material count).
        return scoped[:k]
    return list(picked.values())
