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


def test_set_phase_done_generic(test_db):
    p = BidProjectService.create(test_db, user_id=1, title="T", workspace_ref="w")
    BidProjectService.set_phase_done(test_db, project=p, phase=2)
    assert p.phase_status["phase2"] == "done" and p.current_phase == 3
    assert p.max_phase_reached == 3


def test_begin_draft_atomic(test_db):
    p = BidProjectService.create(test_db, user_id=1, title="D", workspace_ref="w")
    assert BidProjectService.begin_draft(test_db, project_id=p.id, user_id=1) is True
    # Already drafting: a second lock attempt fails.
    assert BidProjectService.begin_draft(test_db, project_id=p.id, user_id=1) is False


def test_reset_stuck_parsing_flips_to_failed(test_db):
    p1 = BidProjectService.create(test_db, user_id=9, title="P", workspace_ref="w-p")
    BidProjectService.begin_parse(test_db, project_id=p1.id, user_id=9)  # -> parsing
    p2 = BidProjectService.create(test_db, user_id=9, title="Q", workspace_ref="w-q")
    n = BidProjectService.reset_stuck_parsing(test_db)
    assert n == 1
    test_db.refresh(p1)
    test_db.refresh(p2)
    assert p1.status == "parse_failed"
    assert p2.status == "created"  # untouched


def test_mark_done_sets_status(test_db):
    p = BidProjectService.create(test_db, user_id=9, title="R", workspace_ref="w-r")
    BidProjectService.mark_done(test_db, project=p)
    assert p.status == "done"
