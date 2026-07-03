# SPDX-License-Identifier: Apache-2.0
"""Regression for resolve_tender_model against the real ModelAggregationService API.

The bug this guards: model_resolver constructed ``ModelAggregationService(db)``
but the class takes no constructor args (db is a per-call arg on resolve_model).
API tests patched resolve_tender_model wholesale, so its body was never exercised
and the TypeError only surfaced in real-machine E2E.
"""

from unittest.mock import MagicMock, patch

from app.services.bid.model_resolver import resolve_tender_model


def test_resolve_tender_model_empty_name_returns_default(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "BID_TENDER_MODEL_NAME", "")
    assert resolve_tender_model(MagicMock(), MagicMock()) == ("", None)


def test_resolve_tender_model_constructs_service_with_no_args(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "BID_TENDER_MODEL_NAME", "qwen3.7-max")
    db, user = MagicMock(), MagicMock()

    with patch("app.services.model_aggregation_service.ModelAggregationService") as Svc:
        Svc.return_value.resolve_model.return_value = {
            "name": "qwen3.7-max",
            "config": {"model": "qwen3.7-max", "provider": "anthropic"},
        }
        model_name, cfg = resolve_tender_model(db, user)

    # Constructor must take NO args (the original bug passed db here).
    Svc.assert_called_once_with()
    Svc.return_value.resolve_model.assert_called_once_with(
        db, current_user=user, name="qwen3.7-max"
    )
    assert model_name == "qwen3.7-max"
    assert cfg == {"model": "qwen3.7-max", "provider": "anthropic"}


def test_resolve_tender_model_unresolved_returns_name_none(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "BID_TENDER_MODEL_NAME", "missing")
    with patch("app.services.model_aggregation_service.ModelAggregationService") as Svc:
        Svc.return_value.resolve_model.return_value = None
        assert resolve_tender_model(MagicMock(), MagicMock()) == ("missing", None)
