# SPDX-License-Identifier: Apache-2.0
from app.models.bid_project import BidProject


def test_bid_project_row_roundtrip(test_db):
    row = BidProject(
        user_id=1,
        title="智慧园区",
        workspace_ref="bid-abc",
        phase_status={},
        current_phase=1,
        max_phase_reached=1,
        status="created",
    )
    test_db.add(row)
    test_db.commit()
    got = test_db.query(BidProject).filter(BidProject.id == row.id).first()
    assert got.title == "智慧园区" and got.current_phase == 1 and got.phase_status == {}
