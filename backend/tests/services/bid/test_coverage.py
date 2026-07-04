# SPDX-License-Identifier: Apache-2.0
from app.services.bid.coverage import compute_coverage
from app.services.bid.tender_normalize import normalized_tender


def test_coverage_basic():
    outline = {"sections": [{"id": "s1", "covers": ["T1"]}]}
    tender = {"scoring": [{"id": "T1", "weight": 10, "category": "技术"}]}
    cov = compute_coverage(outline, tender)
    assert cov["total"] == 1 and cov["covered"] == 1


def test_coverage_reads_bucketed_scoring_and_is_veto():
    tender = normalized_tender(
        {
            "scoring": {"tech_items": [{"id": "T1", "title": "方案", "max_score": 20}]},
            "mandatory_clauses": [{"id": "M1", "is_veto": True}],
        }
    )
    outline = {"sections": [{"id": "s1", "covers": ["T1"]}]}
    cov = compute_coverage(outline, tender)
    assert cov["total"] == 2  # T1 + M1(veto)
    assert cov["covered"] == 1  # T1 covered, M1 not
    assert cov["uncovered_clauses"] == ["M1"]
