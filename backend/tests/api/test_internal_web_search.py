# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for internal web search API."""

import json
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(autouse=True)
def reset_factory_cache():
    import app.services.search.factory as factory_module

    factory_module._search_services.clear()
    factory_module._engines_config = None
    yield
    factory_module._search_services.clear()
    factory_module._engines_config = None


def test_internal_web_search_disabled(test_client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "WEB_SEARCH_ENABLED", False)

    response = test_client.post(
        "/api/internal/web-search/search",
        json={"query": "test"},
    )

    assert response.status_code == 400
    assert "disabled" in response.json()["detail"].lower()


def test_internal_web_search_success(test_client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "WEB_SEARCH_ENABLED", True)
    monkeypatch.setattr(
        settings,
        "WEB_SEARCH_ENGINES",
        json.dumps(
            {
                "default": "bocha",
                "engines": {"bocha": {"type": "bocha", "display_name": "博查"}},
            }
        ),
    )
    monkeypatch.setattr(settings, "BOCHA_API_KEY", "sk-test")

    mock_service = AsyncMock()
    mock_service.search_raw.return_value = [
        {
            "title": "Example",
            "url": "https://example.com",
            "snippet": "snippet",
            "content": "content",
        }
    ]

    with patch(
        "app.api.endpoints.internal.web_search.get_search_service",
        return_value=mock_service,
    ):
        response = test_client.post(
            "/api/internal/web-search/search",
            json={"query": "hello", "limit": 5},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "hello"
    assert data["count"] == 1
    assert data["results"][0]["title"] == "Example"
    mock_service.search_raw.assert_awaited_once_with(query="hello", limit=5)
