# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for Bocha search service."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.search.bocha_search import BochaSearchService


@pytest.fixture
def bocha_service() -> BochaSearchService:
    return BochaSearchService(api_key="test-api-key")


@pytest.mark.asyncio
async def test_search_raw_maps_bocha_response(bocha_service: BochaSearchService):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "data": {
            "webPages": {
                "value": [
                    {
                        "name": "Example Title",
                        "url": "https://example.com",
                        "snippet": "short snippet",
                        "summary": "long summary",
                        "siteName": "Example",
                    }
                ]
            }
        }
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        results = await bocha_service.search_raw("test query", limit=5)

    assert len(results) == 1
    assert results[0]["title"] == "Example Title"
    assert results[0]["url"] == "https://example.com"
    assert results[0]["snippet"] == "long summary"
    assert results[0]["content"] == "long summary"

    mock_client.post.assert_awaited_once()
    call_kwargs = mock_client.post.await_args.kwargs
    assert call_kwargs["json"]["query"] == "test query"
    assert call_kwargs["json"]["count"] == 5
    assert call_kwargs["headers"]["Authorization"] == "Bearer test-api-key"


@pytest.mark.asyncio
async def test_search_raw_falls_back_to_snippet(bocha_service: BochaSearchService):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "data": {
            "webPages": {
                "value": [
                    {
                        "name": "Only Snippet",
                        "url": "https://example.com/page",
                        "snippet": "snippet only",
                    }
                ]
            }
        }
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        results = await bocha_service.search_raw("query")

    assert results[0]["snippet"] == "snippet only"
    assert results[0]["content"] == "snippet only"


@pytest.mark.asyncio
async def test_search_raw_empty_query(bocha_service: BochaSearchService):
    results = await bocha_service.search_raw("")
    assert results == []


@pytest.mark.asyncio
async def test_search_raw_http_error(bocha_service: BochaSearchService):
    request = httpx.Request("POST", "https://api.bochaai.com/v1/web-search")
    response = httpx.Response(401, request=request, text="Unauthorized")

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(
        side_effect=httpx.HTTPStatusError(
            "Unauthorized", request=request, response=response
        )
    )
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(Exception, match="401"):
            await bocha_service.search_raw("query")
