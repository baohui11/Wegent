# SPDX-License-Identifier: Apache-2.0
"""Deterministic coverage check: every scoring item and every ★ (veto) clause
must be covered by some outline section/volume `covers` list."""


def _covered_ids(outline: dict) -> set[str]:
    ids: set[str] = set()

    def walk(node: dict) -> None:
        for cid in node.get("covers", []) or []:
            ids.add(str(cid))
        for child in node.get("children", []) or []:
            walk(child)

    for group in ("sections", "volumes"):
        for node in outline.get(group, []) or []:
            walk(node)  # recurse: covers may live on any node, incl. leaves
    return ids


def _scoring_text(s: dict) -> str:
    # `item` is the canonical key set by normalize_scoring; coverage always
    # receives a normalized tender (callers resolve via ensure_normalized_tender).
    return str(s.get("item") or "").strip()


def _clause_text(c: dict) -> str:
    # `text` is the canonical key set by normalize_clauses.
    return str(c.get("text") or "").strip()


def compute_coverage(outline: dict, tender: dict) -> dict:
    """Uncovered items carry their human text (from the normalized tender) so the
    UI can show *what* is uncovered, not just an internal id."""
    covered = _covered_ids(outline)
    scoring_required, uncovered_scoring = 0, []
    for s in tender.get("scoring", []) or []:
        sid = str(s.get("id"))
        if s.get("target_scope") == "whole_technical_volume":
            continue  # whole-volume score, exempt from per-section coverage
        scoring_required += 1
        if sid not in covered:
            uncovered_scoring.append(
                {
                    "id": sid,
                    "text": _scoring_text(s),
                    "target_section": str(s.get("target_section") or ""),
                }
            )
    clause_required, uncovered_clauses = 0, []
    for c in tender.get("mandatory_clauses", []) or []:
        if not c.get("veto"):
            continue
        cid = str(c.get("id"))
        clause_required += 1
        if cid not in covered:
            uncovered_clauses.append({"id": cid, "text": _clause_text(c)})
    total = scoring_required + clause_required
    covered_n = total - len(uncovered_scoring) - len(uncovered_clauses)
    return {
        "total": total,
        "covered": covered_n,
        "uncovered_scoring": uncovered_scoring,
        "uncovered_clauses": uncovered_clauses,
    }
