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


from app.services.bid.project_service import BidProjectService


def test_create_get_list_isolation(test_db):
    p = BidProjectService.create(test_db, user_id=7, title="A", workspace_ref="w-a")
    assert BidProjectService.get(test_db, user_id=7, project_id=p.id).title == "A"
    assert BidProjectService.get(test_db, user_id=8, project_id=p.id) is None
    assert [r.id for r in BidProjectService.list(test_db, user_id=7)] == [p.id]


def test_begin_parse_is_atomic_lock(test_db):
    p = BidProjectService.create(test_db, user_id=7, title="B", workspace_ref="w-b")
    assert BidProjectService.begin_parse(test_db, project_id=p.id, user_id=7) is True
    # Already parsing: a second lock attempt fails.
    assert BidProjectService.begin_parse(test_db, project_id=p.id, user_id=7) is False


def test_complete_phase1_advances_cursor(test_db):
    p = BidProjectService.create(test_db, user_id=7, title="C", workspace_ref="w-c")
    BidProjectService.complete_phase1(test_db, project=p)
    assert p.phase_status["phase1"] == "done" and p.current_phase == 2
    assert p.max_phase_reached == 2 and p.status == "parsed"
