# SPDX-License-Identifier: Apache-2.0
from app.services.bid import review_service as rs
from app.services.bid.workspace import BidWorkspace


def test_accept_and_read(tmp_path):
    ws = BidWorkspace("rv1", root=tmp_path)
    assert rs.read_review(ws) == {"accepted": {}}
    rs.mark_accepted(ws, "s1")
    rs.mark_accepted(ws, "s2")
    assert rs.read_review(ws)["accepted"] == {"s1": True, "s2": True}
