# SPDX-License-Identifier: Apache-2.0
from unittest.mock import AsyncMock, patch

from app.core.config import settings
from app.core.security import create_access_token, get_password_hash
from app.models.user import User


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
