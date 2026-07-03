# SPDX-License-Identifier: Apache-2.0
from app.services.bid.coverage import compute_coverage


def test_reports_uncovered_scoring_and_clauses():
    tender = {
        "scoring": [
            {"id": "S1"},
            {"id": "S2"},
            {"id": "S3", "target_scope": "whole_technical_volume"},
        ],
        "mandatory_clauses": [{"id": "V1", "veto": True}, {"id": "V2", "veto": False}],
    }
    outline = {"sections": [{"covers": ["S1", "V1"]}], "volumes": [{"covers": ["S2"]}]}
    rep = compute_coverage(outline, tender)
    # S1,S2 covered; S3 exempt; V1 covered; V2 not a red line
    assert rep["uncovered_scoring"] == [] and rep["uncovered_clauses"] == []
    assert (
        rep["total"] == 3 and rep["covered"] == 3
    )  # S1,S2 + V1 red line; S3 exempt counts covered


def test_flags_missing():
    tender = {
        "scoring": [{"id": "S1"}],
        "mandatory_clauses": [{"id": "V1", "veto": True}],
    }
    outline = {"sections": [{"covers": ["S1"]}]}
    rep = compute_coverage(outline, tender)
    assert rep["uncovered_scoring"] == [] and rep["uncovered_clauses"] == ["V1"]
