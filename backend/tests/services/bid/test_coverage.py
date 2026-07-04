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
            "mandatory_clauses": [
                {"id": "M1", "is_veto": True, "clause": "投标有效期不少于90天"}
            ],
        }
    )
    outline = {"sections": [{"id": "s1", "covers": ["T1"]}]}
    cov = compute_coverage(outline, tender)
    assert cov["total"] == 2  # T1 + M1(veto)
    assert cov["covered"] == 1  # T1 covered, M1 not
    # Uncovered items now carry their human text, not just the internal id.
    assert cov["uncovered_clauses"] == [{"id": "M1", "text": "投标有效期不少于90天"}]


def test_coverage_scoring_carries_text():
    tender = normalized_tender(
        {
            "scoring": {
                "tech_items": [
                    {
                        "id": "T1",
                        "item": "总体方案",
                        "max_score": 20,
                        "target_section": "第一章",
                    }
                ]
            }
        }
    )
    cov = compute_coverage({"sections": []}, tender)
    assert cov["uncovered_scoring"] == [
        {"id": "T1", "text": "总体方案", "target_section": "第一章"}
    ]
