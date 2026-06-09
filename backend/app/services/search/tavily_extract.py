# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tavily Extract API integration via tavily-python SDK."""

import logging
from typing import Any

from tavily import AsyncTavilyClient

logger = logging.getLogger(__name__)

TAVILY_EXTRACT_MAX_URLS = 5


class TavilyExtractService:
    """Fetch and extract web page content using Tavily Extract API."""

    def __init__(
        self,
        api_key: str,
        *,
        include_favicon: bool = True,
        include_usage: bool = True,
        timeout: float = 30,
    ):
        self.include_favicon = include_favicon
        self.include_usage = include_usage
        self.timeout = timeout
        self._client = AsyncTavilyClient(api_key=api_key)

    async def extract_urls(self, urls: list[str]) -> dict[str, Any]:
        """Extract content from the given URLs."""
        normalized_urls = []
        for url in urls:
            cleaned = url.strip()
            if cleaned and cleaned not in normalized_urls:
                normalized_urls.append(cleaned)

        if not normalized_urls:
            return {"results": [], "failed_results": [], "count": 0}

        if len(normalized_urls) > TAVILY_EXTRACT_MAX_URLS:
            raise ValueError(
                f"Too many URLs (max {TAVILY_EXTRACT_MAX_URLS} per request)"
            )

        try:
            response = await self._client.extract(
                urls=normalized_urls,
                include_favicon=self.include_favicon,
                include_usage=self.include_usage,
                timeout=self.timeout,
            )
        except Exception as exc:
            logger.exception("Tavily extract failed for urls=%s", normalized_urls)
            raise Exception(f"Tavily extract error: {exc!s}") from exc

        if not isinstance(response, dict):
            return {"results": [], "failed_results": [], "count": 0}

        results = response.get("results") or []
        failed_results = response.get("failed_results") or []
        formatted_results = [
            self._format_result(item) for item in results if isinstance(item, dict)
        ]
        formatted_failed = [
            self._format_failed(item)
            for item in failed_results
            if isinstance(item, dict)
        ]

        logger.info(
            "Tavily extract completed: success=%d failed=%d",
            len(formatted_results),
            len(formatted_failed),
        )

        payload: dict[str, Any] = {
            "results": formatted_results,
            "failed_results": formatted_failed,
            "count": len(formatted_results),
        }
        if "usage" in response:
            payload["usage"] = response["usage"]

        return payload

    @staticmethod
    def _format_result(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "url": str(item.get("url", "")).strip(),
            "title": str(item.get("title", "")).strip(),
            "content": str(
                item.get("raw_content") or item.get("content") or ""
            ).strip(),
            "favicon": str(item.get("favicon", "")).strip() or None,
        }

    @staticmethod
    def _format_failed(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "url": str(item.get("url", "")).strip(),
            "error": str(item.get("error", "")).strip(),
        }
