# SPDX-License-Identifier: Apache-2.0
"""Regression for resolve_tender_model.

Guards two bugs found only in real-machine E2E (API tests patched
resolve_tender_model wholesale, so its body was never exercised):

1. It constructed ``ModelAggregationService(db)`` (takes no args).
2. Worse, ``resolve_model`` strips the sensitive ``env`` block, so the returned
   config had no api_key/base_url -> chat_shell fell back to gpt-4/OpenAI with
   "Missing credentials". The fix mirrors prompt_draft: look up the Model Kind
   and run the shared ``extract_and_process_model_config`` (which decrypts env).
"""

from unittest.mock import MagicMock, patch

from app.services.bid.model_resolver import resolve_tender_model


def test_empty_name_returns_default(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "BID_TENDER_MODEL_NAME", "")
    assert resolve_tender_model(MagicMock(), MagicMock()) == ("", None)


def test_resolves_credential_bearing_config(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "BID_TENDER_MODEL_NAME", "qwen3.7-max")
    user = MagicMock(id=1, user_name="admin")
    kind = MagicMock()
    kind.json = {"spec": {"protocol": "anthropic", "modelConfig": {"env": {}}}}
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = kind

    full_cfg = {
        "api_key": "sk-secret",
        "base_url": "https://api.example.com/v1",
        "model_id": "qwen3.7-max",
        "model": "anthropic",
    }
    with patch(
        "app.services.chat.config.extract_and_process_model_config",
        return_value=full_cfg,
    ) as ex:
        model_id, cfg = resolve_tender_model(db, user)

    ex.assert_called_once_with(
        model_spec={"protocol": "anthropic", "modelConfig": {"env": {}}},
        user_id=1,
        user_name="admin",
    )
    assert model_id == "qwen3.7-max"
    # The whole point: credentials must survive to chat_shell.
    assert cfg["api_key"] == "sk-secret"
    assert cfg["base_url"] == "https://api.example.com/v1"


def test_model_not_found_returns_name_none(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "BID_TENDER_MODEL_NAME", "missing")
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    assert resolve_tender_model(db, MagicMock(id=1, user_name="admin")) == (
        "missing",
        None,
    )


def test_resolve_project_model_falls_back_when_empty(monkeypatch):
    from app.services.bid import model_resolver as mr

    class P:
        model_name = ""

    # empty project model_name -> delegates to resolve_tender_model (global)
    with patch.object(mr, "resolve_tender_model", return_value=("g", {"api_key": "k"})):
        assert mr.resolve_project_model(MagicMock(), MagicMock(id=1), P()) == (
            "g",
            {"api_key": "k"},
        )


def test_validate_model_config_rejects_empty():
    import pytest

    from app.services.bid.model_resolver import validate_model_config

    with pytest.raises(ValueError):
        validate_model_config("qwen", None)
    with pytest.raises(ValueError):
        validate_model_config("qwen", {})  # no credentials
    # credential-bearing config passes
    validate_model_config("qwen", {"api_key": "k", "model_id": "qwen"})
