# SPDX-License-Identifier: Apache-2.0
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.core.security import create_access_token, get_password_hash
from app.models.user import User
from app.services.bid.workspace import BidWorkspace


def _second_user(test_db) -> tuple[User, str]:
    # Field set mirrors tests/conftest.py::test_user (User requires user_name +
    # password_hash NOT NULL; is_active/git_info match the existing fixture).
    u = User(
        user_name="user2",
        password_hash=get_password_hash("user2password123"),
        email="u2@x.com",
        is_active=True,
        git_info=None,
    )
    test_db.add(u)
    test_db.commit()
    test_db.refresh(u)
    return u, create_access_token(data={"sub": u.user_name})


def test_bid_crud_and_parse(test_client, test_token, tmp_path, monkeypatch):
    # Redirect per-project workspaces to a writable temp root (default points at
    # /data/bid-workspaces which is not writable in the test environment).
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post(
        "/api/bid/projects", json={"title": "智慧园区"}, headers=h
    ).json()["id"]
    assert any(
        p["id"] == pid for p in test_client.get("/api/bid/projects", headers=h).json()
    )

    # parse_tender mock also persists tender.json (the real orchestrator writes
    # the blackboard file), so the subsequent /tender read can return it.
    async def _parse(ws, *, model, model_config):
        doc = {"scoring": [{"id": "S1"}]}
        ws.write_json("workspace/tender.json", doc)
        return doc

    with (
        patch(
            "app.api.endpoints.bid.parse_tender",
            new=AsyncMock(side_effect=_parse),
        ),
        patch("app.api.endpoints.bid.resolve_tender_model", return_value=("m", None)),
    ):
        r = test_client.post(
            f"/api/bid/projects/{pid}/parse",
            json={"tender_text": "招标正文"},
            headers=h,
        )
    assert r.status_code == 200 and r.json()["status"] == "parsed"
    t = test_client.get(f"/api/bid/projects/{pid}/tender", headers=h)
    assert t.json()["tender"]["scoring"][0]["id"] == "S1"


def test_bid_ownership_isolation(
    test_client, test_token, test_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post("/api/bid/projects", json={"title": "A"}, headers=h).json()[
        "id"
    ]
    _u2, tok2 = _second_user(test_db)
    r = test_client.get(
        f"/api/bid/projects/{pid}", headers={"Authorization": f"Bearer {tok2}"}
    )
    assert r.status_code == 404


def test_parse_unexpected_error_releases_lock(
    test_client, test_token, tmp_path, monkeypatch
):
    # An unexpected (non-BidPipelineError) failure must not leave the project
    # stuck in status='parsing' (the begin_parse lock).
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post("/api/bid/projects", json={"title": "X"}, headers=h).json()[
        "id"
    ]
    with (
        patch("app.api.endpoints.bid.resolve_tender_model", return_value=("m", None)),
        patch(
            "app.api.endpoints.bid.parse_tender",
            new=AsyncMock(side_effect=ValueError("boom")),
        ),
    ):
        with pytest.raises(ValueError):
            test_client.post(
                f"/api/bid/projects/{pid}/parse",
                json={"tender_text": "x"},
                headers=h,
            )
    status = test_client.get(f"/api/bid/projects/{pid}", headers=h).json()["status"]
    assert status == "parse_failed"


def test_outline_build_read_edit_coverage(
    test_client, test_token, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post("/api/bid/projects", json={"title": "O"}, headers=h).json()[
        "id"
    ]

    # Pre-seed tender.json into the project workspace. workspace_ref is now
    # exposed via the project response so the test can locate the blackboard.
    ws_ref = test_client.get(f"/api/bid/projects/{pid}", headers=h).json()[
        "workspace_ref"
    ]
    ws = BidWorkspace(ws_ref)
    ws.write_json(
        "workspace/tender.json",
        {
            "scoring": [{"id": "S1"}],
            "mandatory_clauses": [{"id": "V1", "veto": True}],
        },
    )

    async def _build(_ws):
        _ws.write_json(
            "workspace/outline.json",
            {"sections": [{"id": "a", "covers": ["S1"]}], "volumes": []},
        )
        return _ws.read_json("workspace/outline.json")

    with patch(
        "app.api.endpoints.bid.build_outline_for_project",
        new=AsyncMock(side_effect=_build),
    ):
        r = test_client.post(f"/api/bid/projects/{pid}/outline", headers=h)
    assert r.status_code == 200
    assert r.json()["coverage"]["uncovered_clauses"] == ["V1"]  # V1 not covered

    # Human edit writeback: add V1 to coverage.
    edited = {"sections": [{"id": "a", "covers": ["S1", "V1"]}], "volumes": []}
    r2 = test_client.put(
        f"/api/bid/projects/{pid}/outline", json={"outline": edited}, headers=h
    )
    assert r2.json()["coverage"]["uncovered_clauses"] == []


def test_package_declaration(test_client, test_token, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post("/api/bid/projects", json={"title": "P"}, headers=h).json()[
        "id"
    ]
    r = test_client.post(
        f"/api/bid/projects/{pid}/package", json={"package": "包件二"}, headers=h
    )
    assert r.status_code == 200 and r.json()["status"] == "declared"
    ws_ref = test_client.get(f"/api/bid/projects/{pid}", headers=h).json()[
        "workspace_ref"
    ]
    ws = BidWorkspace(ws_ref)
    assert ws.read_json("corpus/bid_config.json")["package"] == "包件二"


def test_materials_kb_quals_attachments_and_complete(
    test_client, test_token, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post("/api/bid/projects", json={"title": "M"}, headers=h).json()[
        "id"
    ]

    # knowledge base put/get
    kb = {"knowledge_base": {"bidder_knowledge_base": {"cases": [{"name": "案例甲"}]}}}
    assert (
        test_client.put(
            f"/api/bid/projects/{pid}/materials/knowledge-base", json=kb, headers=h
        ).status_code
        == 200
    )
    got = test_client.get(
        f"/api/bid/projects/{pid}/materials/knowledge-base", headers=h
    ).json()
    assert (
        got["knowledge_base"]["bidder_knowledge_base"]["cases"][0]["name"] == "案例甲"
    )

    # bad shape -> 400
    bad = {"knowledge_base": {"nope": 1}}
    assert (
        test_client.put(
            f"/api/bid/projects/{pid}/materials/knowledge-base", json=bad, headers=h
        ).status_code
        == 400
    )

    # qualifications
    q = {
        "qualifications": {"company": "好大一家", "items": {"Q1": {"title": "ISO9001"}}}
    }
    assert (
        test_client.put(
            f"/api/bid/projects/{pid}/materials/qualifications", json=q, headers=h
        ).status_code
        == 200
    )

    # attachment upload + list
    r = test_client.post(
        f"/api/bid/projects/{pid}/materials/attachments",
        files={"file": ("iso9001.pdf", b"PDFDATA", "application/pdf")},
        headers=h,
    )
    assert r.status_code == 200 and r.json() == {"name": "iso9001.pdf", "size": 7}
    lst = test_client.get(
        f"/api/bid/projects/{pid}/materials/attachments", headers=h
    ).json()
    assert lst["items"] == [{"name": "iso9001.pdf", "size": 7}]

    # complete -> phase advances
    assert (
        test_client.post(
            f"/api/bid/projects/{pid}/materials/complete", headers=h
        ).json()["status"]
        == "materials_done"
    )
    assert (
        test_client.get(f"/api/bid/projects/{pid}", headers=h).json()["current_phase"]
        == 4
    )


def test_materials_kb_missing_returns_409(
    test_client, test_token, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post("/api/bid/projects", json={"title": "N"}, headers=h).json()[
        "id"
    ]
    assert (
        test_client.get(
            f"/api/bid/projects/{pid}/materials/knowledge-base", headers=h
        ).status_code
        == 409
    )


def test_draft_trigger_and_status(test_client, test_token, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post("/api/bid/projects", json={"title": "D"}, headers=h).json()[
        "id"
    ]
    ref = test_client.get(f"/api/bid/projects/{pid}", headers=h).json()["workspace_ref"]

    ws = BidWorkspace(ref, root=tmp_path)
    # no outline -> 409
    assert (
        test_client.post(f"/api/bid/projects/{pid}/draft", headers=h).status_code == 409
    )
    ws.write_json("workspace/outline.json", {"sections": [{"id": "s1", "covers": []}]})

    with (
        patch("app.api.endpoints.bid.launch_drafting") as launch,
        patch("app.api.endpoints.bid.resolve_tender_model", return_value=("m", None)),
    ):
        r = test_client.post(f"/api/bid/projects/{pid}/draft", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "drafting"
    launch.assert_called_once()
    # placeholder status readable
    assert (
        test_client.get(f"/api/bid/projects/{pid}/draft/status", headers=h).json()[
            "finished"
        ]
        is False
    )

    # pre-seed a section artifact -> sections list + read single section
    ws.path("workspace/sections").mkdir(parents=True, exist_ok=True)
    ws.path("workspace/sections/s1.md").write_text("正文一", encoding="utf-8")
    assert any(
        i["id"] == "s1"
        for i in test_client.get(f"/api/bid/projects/{pid}/sections", headers=h).json()[
            "items"
        ]
    )
    assert (
        test_client.get(f"/api/bid/projects/{pid}/sections/s1", headers=h).json()[
            "content"
        ]
        == "正文一"
    )


def test_review_redraft_accept_complete(test_client, test_token, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "BID_WORKSPACE_ROOT", str(tmp_path))
    h = {"Authorization": f"Bearer {test_token}"}
    pid = test_client.post("/api/bid/projects", json={"title": "R"}, headers=h).json()[
        "id"
    ]
    ref = test_client.get(f"/api/bid/projects/{pid}", headers=h).json()["workspace_ref"]
    ws = BidWorkspace(ref, root=tmp_path)
    ws.write_json("workspace/outline.json", {"sections": [{"id": "s1", "covers": []}]})

    # section not in outline -> 404
    assert (
        test_client.post(
            f"/api/bid/projects/{pid}/sections/zzz/redraft", json={}, headers=h
        ).status_code
        == 404
    )

    with (
        patch("app.api.endpoints.bid.launch_redraft") as launch,
        patch("app.api.endpoints.bid.resolve_tender_model", return_value=("m", None)),
    ):
        r = test_client.post(
            f"/api/bid/projects/{pid}/sections/s1/redraft",
            json={"instruction": "更简洁"},
            headers=h,
        )
    assert r.status_code == 200 and r.json()["status"] == "drafting"
    launch.assert_called_once()

    assert (
        test_client.post(
            f"/api/bid/projects/{pid}/sections/s1/accept", headers=h
        ).json()["status"]
        == "accepted"
    )
    assert test_client.get(f"/api/bid/projects/{pid}/review/status", headers=h).json()[
        "accepted"
    ] == {"s1": True}
    assert (
        test_client.post(f"/api/bid/projects/{pid}/review/complete", headers=h).json()[
            "status"
        ]
        == "review_done"
    )
    assert (
        test_client.get(f"/api/bid/projects/{pid}", headers=h).json()["current_phase"]
        == 6
    )
