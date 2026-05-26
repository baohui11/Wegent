# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Bocha Web Search API integration.

Docs: https://open.bochaai.com/
API: POST https://api.bochaai.com/v1/web-search
"""

import logging
from typing import Any

import httpx

from .base import SearchServiceBase

logger = logging.getLogger(__name__)

DEFAULT_BOCHA_WEB_SEARCH_URL = "https://api.bochaai.com/v1/web-search"
BOCHA_MAX_COUNT = 50


class BochaSearchService(SearchServiceBase):
    """Search service for Bocha Web Search API (POST + JSON body)."""

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BOCHA_WEB_SEARCH_URL,
        max_results: int = 10,
        freshness: str = "noLimit",
        summary: bool = True,
        timeout: int = 15,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_results = max_results
        self.freshness = freshness
        self.summary = summary
        self.timeout = timeout

    async def search_raw(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """Perform a Bocha web search and return normalized results."""
        if not query:
            return []

        effective_count = min(limit, self.max_results, BOCHA_MAX_COUNT)
        payload = {
            "query": query,
            "freshness": self.freshness,
            "summary": self.summary,
            "count": effective_count,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.base_url,
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                data = response.json()

            raw_results = self._extract_web_pages(data)
            formatted_results: list[dict[str, Any]] = []

            for item in raw_results[:effective_count]:
                if not isinstance(item, dict):
                    continue

                summary_text = self._get_text(item, "summary")
                snippet_text = summary_text or self._get_text(item, "snippet")

                formatted_results.append(
                    {
                        "title": self._get_text(item, "name"),
                        "url": self._get_text(item, "url"),
                        "snippet": snippet_text,
                        "content": summary_text or snippet_text,
                    }
                )

            logger.info(
                "Bocha search successful for query '%s': %s results",
                query,
                len(formatted_results),
            )
            return formatted_results

        except httpx.HTTPStatusError as e:
            logger.error(
                "Bocha search failed with status %s: %s",
                e.response.status_code,
                e.response.text,
            )
            raise Exception(
                f"Bocha search API returned error: {e.response.status_code}"
            ) from e
        except Exception as e:
            logger.exception("Bocha search failed for query '%s'", query)
            raise Exception(f"Bocha search error: {e!s}") from e

    @staticmethod
    def _extract_web_pages(response_data: Any) -> list[dict[str, Any]]:
        """Extract web page results from Bocha API response."""
        if not isinstance(response_data, dict):
            return []

        data = response_data.get("data")
        if not isinstance(data, dict):
            return []

        web_pages = data.get("webPages")
        if not isinstance(web_pages, dict):
            return []

        value = web_pages.get("value")
        return value if isinstance(value, list) else []

    @staticmethod
    def _get_text(item: dict[str, Any], key: str) -> str:
        value = item.get(key)
        return str(value).strip() if value is not None else ""
