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
