# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tavily Web Search API integration via tavily-python SDK."""

import logging
from typing import Any

from tavily import AsyncTavilyClient

from .base import SearchServiceBase

logger = logging.getLogger(__name__)

TAVILY_MAX_RESULTS = 10

# Tavily Search API expects lowercase full country names (see Tavily docs),
# not ISO 3166-1 alpha-2 codes. Map common ISO codes for convenience.
ISO_TO_TAVILY_COUNTRY: dict[str, str] = {
    "CN": "china",
    "US": "united states",
    "GB": "united kingdom",
    "UK": "united kingdom",
    "JP": "japan",
    "KR": "south korea",
    "TW": "taiwan",
    "SG": "singapore",
    "DE": "germany",
    "FR": "france",
    "AU": "australia",
    "CA": "canada",
    "IN": "india",
}


def normalize_tavily_country(value: str) -> str | None:
    """Normalize a country hint to Tavily's expected lowercase country name."""
    normalized = value.strip()
    if not normalized:
        return None

    iso_key = normalized.upper()
    if len(iso_key) == 2 and iso_key in ISO_TO_TAVILY_COUNTRY:
        return ISO_TO_TAVILY_COUNTRY[iso_key]

    return normalized.lower()


def resolve_tavily_country(
    call_country: str | None,
    default_country: str,
) -> str | None:
    """Resolve Tavily country parameter from call-time override and default.

    - ``None`` (omitted at call time): use ``default_country`` if non-empty
    - ``""`` (explicit empty): omit country (global / no regional bias)
    - other values: ISO code (e.g. ``CN``) or Tavily country name (e.g. ``china``)
    """
    if call_country is not None:
        return normalize_tavily_country(call_country)

    if not default_country.strip():
        return None
    return normalize_tavily_country(default_country)


class TavilySearchService(SearchServiceBase):
    """Search service for Tavily Search API (AsyncTavilyClient)."""

    def __init__(
        self,
        api_key: str,
        *,
        auto_parameters: bool = True,
        include_favicon: bool = True,
        safe_search: bool = False,
        include_usage: bool = True,
        default_country: str = "china",
        timeout: float = 60,
    ):
        self.api_key = api_key
        self.auto_parameters = auto_parameters
        self.include_favicon = include_favicon
        self.safe_search = safe_search
        self.include_usage = include_usage
        self.default_country = default_country
        self.timeout = timeout
        self._client = AsyncTavilyClient(api_key=api_key)

    async def search_raw(
        self,
        query: str,
        limit: int = 5,
        *,
        country: str | None = None,
    ) -> list[dict[str, Any]]:
        """Perform a Tavily web search and return normalized results."""
        if not query:
            return []

        effective_max_results = min(max(limit, 1), TAVILY_MAX_RESULTS)
        resolved_country = resolve_tavily_country(country, self.default_country)

        search_kwargs: dict[str, Any] = {
            "query": query,
            "max_results": effective_max_results,
            "auto_parameters": self.auto_parameters,
            "include_favicon": self.include_favicon,
            "include_usage": self.include_usage,
            "timeout": self.timeout,
            "safe_search": self.safe_search,
        }
        if resolved_country:
            search_kwargs["country"] = resolved_country

        try:
            response = await self._client.search(**search_kwargs)
        except TypeError as exc:
            if "safe_search" not in str(exc):
                raise
            search_kwargs.pop("safe_search", None)
            logger.debug("Tavily SDK does not accept safe_search; retrying without it")
            response = await self._client.search(**search_kwargs)
        except Exception as exc:
            logger.exception("Tavily search failed for query '%s'", query)
            raise Exception(f"Tavily search error: {exc!s}") from exc

        raw_results = response.get("results") if isinstance(response, dict) else []
        if not isinstance(raw_results, list):
            raw_results = []

        formatted_results: list[dict[str, Any]] = []
        for item in raw_results[:effective_max_results]:
            if not isinstance(item, dict):
                continue

            content = self._get_text(item, "content")
            snippet = content or self._get_text(item, "snippet")

            formatted_results.append(
                {
                    "title": self._get_text(item, "title"),
                    "url": self._get_text(item, "url"),
                    "snippet": snippet,
                    "content": content or snippet,
                    "favicon": self._get_text(item, "favicon") or None,
                    "score": item.get("score"),
                }
            )

        logger.info(
            "Tavily search successful for query '%s' (country=%s): %s results",
            query,
            resolved_country or "global",
            len(formatted_results),
        )
        return formatted_results

    @staticmethod
    def _get_text(item: dict[str, Any], key: str) -> str:
        value = item.get(key)
        return str(value).strip() if value is not None else ""
