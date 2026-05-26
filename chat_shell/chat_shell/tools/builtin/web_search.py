# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Web search tool integrated with backend search service.

In HTTP mode, search is proxied through the backend internal API
(/api/internal/web-search/search), which supports Bocha and other engines.
Legacy GET-based engines can still fall back to direct HTTP calls.
In package mode, it uses the backend's search service directly.
"""

import json
import logging
from typing import Any

from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class WebSearchInput(BaseModel):
    """Input schema for web search tool."""

    query: str = Field(description="Search query")
    max_results: int | None = Field(
        default=None, description="Maximum number of results"
    )


class WebSearchTool(BaseTool):
    """Web search tool that integrates with backend search service.

    In package mode (running inside backend), uses app.services.search directly.
    In HTTP mode (standalone), makes direct HTTP calls to search engine APIs.
    """

    name: str = "web_search"
    display_name: str = "搜索网页"
    description: str = (
        "Search the web for information. Returns a list of relevant web pages with titles, URLs, and snippets."
    )
    args_schema: type[BaseModel] = WebSearchInput

    # Optional: specify which search engine to use (None = use first available)
    engine_name: str | None = None
    # Default max_results from WEB_SEARCH_DEFAULT_MAX_RESULTS setting
    default_max_results: int = 50
    # Search engine configuration (passed from settings)
    engine_config: dict[str, Any] | None = None

    def _run(
        self,
        query: str,
        max_results: int | None = None,
        run_manager: CallbackManagerForToolRun | None = None,
    ) -> str:
        """Synchronous run - not implemented, use async version."""
        raise NotImplementedError("WebSearchTool only supports async execution")

    async def _arun(
        self,
        query: str,
        max_results: int | None = None,
        run_manager: CallbackManagerForToolRun | None = None,
    ) -> str:
        """Execute web search asynchronously.

        Args:
            query: Search query
            max_results: Maximum number of results (if None, use engine config default)
            run_manager: Callback manager

        Returns:
            JSON string with search results
        """
        effective_max_results = (
            max_results if max_results is not None else self.default_max_results
        )

        try:
            # Try to use backend search service (package mode)
            return await self._search_via_backend(query, effective_max_results)
        except ImportError:
            # HTTP mode: proxy search through backend internal API
            backend_result = await self._search_via_backend_http(
                query, effective_max_results
            )
            if backend_result is not None:
                return backend_result
            # Legacy fallback: direct GET to search engine APIs (SearXNG, etc.)
            return await self._search_via_http(query, effective_max_results)

    async def _search_via_backend(self, query: str, max_results: int) -> str:
        """Search using backend's search service (package mode).

        Args:
            query: Search query
            max_results: Maximum number of results

        Returns:
            JSON string with search results
        """
        from app.services.search import get_search_service

        # Get search service instance (use specified engine or default to first)
        search_service = get_search_service(self.engine_name)
        if not search_service:
            return json.dumps(
                {
                    "error": "Web search service not configured. Set WEB_SEARCH_ENABLED=true and configure WEB_SEARCH_ENGINES."
                }
            )

        # Execute search using search_raw to get list of results
        results = await search_service.search_raw(query=query, limit=max_results)

        # Format results
        formatted_results = []
        for result in results:
            formatted_results.append(
                {
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "snippet": result.get("snippet", ""),
                    "content": result.get("content", ""),
                }
            )

        return json.dumps(
            {
                "query": query,
                "results": formatted_results,
                "count": len(formatted_results),
            },
            ensure_ascii=False,
        )

    async def _search_via_backend_http(
        self, query: str, max_results: int
    ) -> str | None:
        """Search via backend internal API (HTTP mode).

        Returns JSON string on success, None if backend proxy is unavailable.
        """
        import httpx

        from chat_shell.core.config import settings

        remote_url = getattr(settings, "REMOTE_STORAGE_URL", "").rstrip("/")
        if not remote_url:
            logger.debug(
                "[WebSearchTool] REMOTE_STORAGE_URL not set, skipping backend proxy"
            )
            return None

        auth_token = (
            getattr(settings, "REMOTE_STORAGE_TOKEN", "")
            or getattr(settings, "INTERNAL_SERVICE_TOKEN", "")
        )
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        payload = {
            "query": query,
            "limit": max_results,
        }
        if self.engine_name:
            payload["engine_name"] = self.engine_name

        logger.info(
            "[WebSearchTool] Searching via backend proxy: engine=%s, query=%s",
            self.engine_name or "default",
            query[:50],
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{remote_url}/web-search/search",
                    json=payload,
                    headers=headers,
                )

                if response.status_code == 200:
                    return json.dumps(response.json(), ensure_ascii=False)

                logger.warning(
                    "[WebSearchTool] Backend search proxy returned %s: %s",
                    response.status_code,
                    response.text[:200],
                )
                return json.dumps(
                    {
                        "error": response.json().get("detail", response.text)
                        if response.headers.get("content-type", "").startswith(
                            "application/json"
                        )
                        else f"Backend search failed with status {response.status_code}",
                        "query": query,
                    },
                    ensure_ascii=False,
                )
        except Exception as e:
            logger.error(
                "[WebSearchTool] Backend search proxy failed: %s",
                e,
                exc_info=True,
            )
            return None

    async def _search_via_http(self, query: str, max_results: int) -> str:
        """Search via direct HTTP call to search engine API (HTTP mode).

        Args:
            query: Search query
            max_results: Maximum number of results

        Returns:
            JSON string with search results
        """
        import httpx

        from chat_shell.core.config import settings

        # Get engine configuration
        engine_config = self.engine_config
        if not engine_config:
            # Try to load from settings
            try:
                engines_json = settings.WEB_SEARCH_ENGINES
                if engines_json and engines_json != "{}":
                    engines_data = json.loads(engines_json)
                    engines = engines_data.get("engines", {})
                    if engines:
                        # Use specified engine or first available
                        if self.engine_name and self.engine_name in engines:
                            engine_config = engines[self.engine_name]
                        else:
                            # Use first engine
                            engine_config = next(iter(engines.values()))
            except Exception as e:
                logger.warning(f"[WebSearchTool] Failed to parse engine config: {e}")

        if not engine_config:
            return json.dumps(
                {
                    "error": "Web search not configured. Set CHAT_SHELL_WEB_SEARCH_ENGINES environment variable.",
                    "query": query,
                }
            )

        # Extract engine configuration
        base_url = engine_config.get("base_url")
        query_param = engine_config.get("query_param", "query")
        limit_param = engine_config.get("limit_param", "limit")
        auth_header = engine_config.get("auth_header", {})
        response_path = engine_config.get("response_path", "results")
        title_field = engine_config.get("title_field", "title")
        url_field = engine_config.get("url_field", "url")
        snippet_field = engine_config.get("snippet_field", "snippet")
        content_field = engine_config.get("content_field", "")

        if not base_url:
            return json.dumps(
                {
                    "error": "Search engine base_url not configured",
                    "query": query,
                }
            )

        logger.info(
            f"[WebSearchTool] Searching via HTTP: engine={self.engine_name or 'default'}, query={query[:50]}"
        )

        try:
            # Build request parameters
            params = {
                query_param: query,
            }
            if limit_param:
                params[limit_param] = max_results

            # Build headers
            headers = {}
            if auth_header:
                headers.update(auth_header)

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(base_url, params=params, headers=headers)

                if response.status_code != 200:
                    logger.warning(
                        f"[WebSearchTool] Search API returned {response.status_code}: {response.text[:200]}"
                    )
                    return json.dumps(
                        {
                            "error": f"Search API returned status {response.status_code}",
                            "query": query,
                        }
                    )

                data = response.json()

                # Extract results using response_path
                results = data
                for path_part in response_path.split("."):
                    if path_part and isinstance(results, dict):
                        results = results.get(path_part, [])

                if not isinstance(results, list):
                    results = []

                # Format results
                formatted_results = []
                for result in results[:max_results]:
                    formatted_result = {
                        "title": result.get(title_field, ""),
                        "url": result.get(url_field, ""),
                        "snippet": result.get(snippet_field, ""),
                    }
                    if content_field and result.get(content_field):
                        formatted_result["content"] = result.get(content_field, "")
                    formatted_results.append(formatted_result)

                logger.info(
                    f"[WebSearchTool] Retrieved {len(formatted_results)} results for query: {query[:50]}"
                )

                return json.dumps(
                    {
                        "query": query,
                        "results": formatted_results,
                        "count": len(formatted_results),
                    },
                    ensure_ascii=False,
                )

        except Exception as e:
            logger.error(f"[WebSearchTool] HTTP search failed: {e}", exc_info=True)
            return json.dumps(
                {
                    "error": f"Web search failed: {str(e)}",
                    "query": query,
                }
            )
