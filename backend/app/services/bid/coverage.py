# SPDX-License-Identifier: Apache-2.0
"""Deterministic coverage check: every scoring item and every ★ (veto) clause
must be covered by some outline section/volume `covers` list."""


def _covered_ids(outline: dict) -> set[str]:
    ids: set[str] = set()
    for group in ("sections", "volumes"):
        for node in outline.get(group, []) or []:
            for cid in node.get("covers", []) or []:
                ids.add(str(cid))
    return ids


def compute_coverage(outline: dict, tender: dict) -> dict:
    covered = _covered_ids(outline)
    scoring_required, uncovered_scoring = [], []
    for s in tender.get("scoring", []) or []:
        sid = str(s.get("id"))
        if s.get("target_scope") == "whole_technical_volume":
            continue  # whole-volume score, exempt from per-section coverage
        scoring_required.append(sid)
        if sid not in covered:
            uncovered_scoring.append(sid)
    clause_required, uncovered_clauses = [], []
    for c in tender.get("mandatory_clauses", []) or []:
        if not c.get("veto"):
            continue
        cid = str(c.get("id"))
        clause_required.append(cid)
        if cid not in covered:
            uncovered_clauses.append(cid)
    total = len(scoring_required) + len(clause_required)
    covered_n = total - len(uncovered_scoring) - len(uncovered_clauses)
    return {
        "total": total,
        "covered": covered_n,
        "uncovered_scoring": uncovered_scoring,
        "uncovered_clauses": uncovered_clauses,
    }
