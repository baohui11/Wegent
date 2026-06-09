# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for Tavily extract service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.search.tavily_extract import TavilyExtractService


@pytest.fixture
def extract_service() -> TavilyExtractService:
    return TavilyExtractService(
        api_key="tvly-test-key",
        include_favicon=True,
        include_usage=True,
    )


@pytest.mark.asyncio
async def test_extract_urls_maps_response(extract_service: TavilyExtractService):
    mock_client = MagicMock()
    mock_client.extract = AsyncMock(
        return_value={
            "results": [
                {
                    "url": "https://example.com/page",
                    "title": "Example Page",
                    "raw_content": "Full page text",
                    "favicon": "https://example.com/favicon.ico",
                }
            ],
            "failed_results": [],
            "usage": {"credits": 1},
        }
    )

    with patch.object(extract_service, "_client", mock_client):
        payload = await extract_service.extract_urls(["https://example.com/page"])

    assert payload["count"] == 1
    assert payload["results"][0]["url"] == "https://example.com/page"
    assert payload["results"][0]["content"] == "Full page text"
    assert payload["usage"] == {"credits": 1}

    mock_client.extract.assert_awaited_once_with(
        urls=["https://example.com/page"],
        include_favicon=True,
        include_usage=True,
        timeout=30,
    )


@pytest.mark.asyncio
async def test_extract_urls_empty_input(extract_service: TavilyExtractService):
    payload = await extract_service.extract_urls(["", "   "])
    assert payload["count"] == 0
    assert payload["results"] == []


@pytest.mark.asyncio
async def test_extract_urls_too_many_raises(extract_service: TavilyExtractService):
    urls = [f"https://example.com/{index}" for index in range(6)]
    with pytest.raises(ValueError, match="Too many URLs"):
        await extract_service.extract_urls(urls)
