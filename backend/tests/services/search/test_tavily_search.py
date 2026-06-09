# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for Tavily search service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.search.tavily_search import (
    TAVILY_MAX_RESULTS,
    TavilySearchService,
    resolve_tavily_country,
)


@pytest.fixture
def tavily_service() -> TavilySearchService:
    return TavilySearchService(
        api_key="tvly-test-key",
        auto_parameters=True,
        include_favicon=True,
        safe_search=False,
        include_usage=True,
        default_country="CN",
    )


@pytest.mark.asyncio
async def test_search_raw_maps_tavily_response(tavily_service: TavilySearchService):
    mock_client = MagicMock()
    mock_client.search = AsyncMock(
        return_value={
            "results": [
                {
                    "title": "Example Title",
                    "url": "https://example.com",
                    "content": "Detailed content",
                    "score": 0.91,
                    "favicon": "https://example.com/favicon.ico",
                }
            ]
        }
    )

    with patch.object(tavily_service, "_client", mock_client):
        results = await tavily_service.search_raw("test query", limit=5)

    assert len(results) == 1
    assert results[0]["title"] == "Example Title"
    assert results[0]["url"] == "https://example.com"
    assert results[0]["snippet"] == "Detailed content"
    assert results[0]["content"] == "Detailed content"
    assert results[0]["favicon"] == "https://example.com/favicon.ico"
    assert results[0]["score"] == 0.91

    mock_client.search.assert_awaited_once_with(
        query="test query",
        max_results=5,
        auto_parameters=True,
        include_favicon=True,
        include_usage=True,
        timeout=60,
        safe_search=False,
        country="china",
    )


def test_resolve_tavily_country_uses_default_when_omitted():
    assert resolve_tavily_country(None, "CN") == "china"
    assert resolve_tavily_country(None, "china") == "china"


def test_resolve_tavily_country_empty_string_means_global():
    assert resolve_tavily_country("", "CN") is None


def test_resolve_tavily_country_explicit_override():
    assert resolve_tavily_country("us", "CN") == "united states"
    assert resolve_tavily_country("china", "CN") == "china"


@pytest.mark.asyncio
async def test_search_raw_omits_country_when_explicitly_global(
    tavily_service: TavilySearchService,
):
    mock_client = MagicMock()
    mock_client.search = AsyncMock(return_value={"results": []})

    with patch.object(tavily_service, "_client", mock_client):
        await tavily_service.search_raw("query", limit=3, country="")

    assert "country" not in mock_client.search.await_args.kwargs


@pytest.mark.asyncio
async def test_search_raw_caps_max_results(tavily_service: TavilySearchService):
    mock_client = MagicMock()
    mock_client.search = AsyncMock(return_value={"results": []})

    with patch.object(tavily_service, "_client", mock_client):
        await tavily_service.search_raw("query", limit=20)

    assert mock_client.search.await_args.kwargs["max_results"] == TAVILY_MAX_RESULTS


@pytest.mark.asyncio
async def test_search_raw_empty_query(tavily_service: TavilySearchService):
    results = await tavily_service.search_raw("")
    assert results == []
