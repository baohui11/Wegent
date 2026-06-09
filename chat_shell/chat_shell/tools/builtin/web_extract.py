# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Web page extraction tool using Tavily Extract API.

In HTTP mode, extraction is proxied through the backend internal API
(/api/internal/web-search/extract).
In package mode, it uses the backend TavilyExtractService directly.
"""

import json
import logging
from typing import Any

from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)


class WebExtractInput(BaseModel):
    """Input schema for web page extraction tool."""

    urls: list[str] = Field(
        description="One or more HTTP(S) URLs to extract readable content from"
    )

    @field_validator("urls")
    @classmethod
    def validate_urls(cls, value: list[str]) -> list[str]:
        cleaned = [url.strip() for url in value if url and url.strip()]
        if not cleaned:
            raise ValueError("At least one valid URL is required")
        return cleaned


class WebExtractTool(BaseTool):
    """Extract readable content from web pages via Tavily Extract."""

    name: str = "web_extract"
    display_name: str = "抓取网页"
    description: str = (
        "Extract readable content from one or more web page URLs. "
        "Use after web_search when you need full page text from specific links."
    )
    args_schema: type[BaseModel] = WebExtractInput

    def _run(
        self,
        urls: list[str],
        run_manager: CallbackManagerForToolRun | None = None,
    ) -> str:
        raise NotImplementedError("WebExtractTool only supports async execution")

    async def _arun(
        self,
        urls: list[str],
        run_manager: CallbackManagerForToolRun | None = None,
    ) -> str:
        try:
            return await self._extract_via_backend(urls)
        except ImportError:
            backend_result = await self._extract_via_backend_http(urls)
            if backend_result is not None:
                return backend_result
            return json.dumps(
                {
                    "error": "Web extract service not available in HTTP mode.",
                    "urls": urls,
                },
                ensure_ascii=False,
            )

    async def _extract_via_backend(self, urls: list[str]) -> str:
        from app.services.search import get_tavily_extract_service

        extract_service = get_tavily_extract_service()
        if not extract_service:
            return json.dumps(
                {
                    "error": (
                        "Tavily extract not configured. Set WEB_SEARCH_ENABLED=true "
                        "and TAVILY_API_KEY."
                    ),
                    "urls": urls,
                },
                ensure_ascii=False,
            )

        payload = await extract_service.extract_urls(urls)
        return json.dumps(payload, ensure_ascii=False)

    async def _extract_via_backend_http(self, urls: list[str]) -> str | None:
        import httpx

        from chat_shell.core.config import settings

        remote_url = getattr(settings, "REMOTE_STORAGE_URL", "").rstrip("/")
        if not remote_url:
            logger.debug(
                "[WebExtractTool] REMOTE_STORAGE_URL not set, skipping backend proxy"
            )
            return None

        auth_token = getattr(settings, "REMOTE_STORAGE_TOKEN", "") or getattr(
            settings, "INTERNAL_SERVICE_TOKEN", ""
        )
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        payload = {"urls": urls}

        logger.info(
            "[WebExtractTool] Extracting via backend proxy: url_count=%d",
            len(urls),
        )

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{remote_url}/web-search/extract",
                    json=payload,
                    headers=headers,
                )

                if response.status_code == 200:
                    return json.dumps(response.json(), ensure_ascii=False)

                logger.warning(
                    "[WebExtractTool] Backend extract proxy returned %s: %s",
                    response.status_code,
                    response.text[:200],
                )
                return json.dumps(
                    {
                        "error": (
                            response.json().get("detail", response.text)
                            if response.headers.get("content-type", "").startswith(
                                "application/json"
                            )
                            else f"Backend extract failed with status {response.status_code}"
                        ),
                        "urls": urls,
                    },
                    ensure_ascii=False,
                )
        except Exception as exc:
            logger.error(
                "[WebExtractTool] Backend extract proxy failed: %s",
                exc,
                exc_info=True,
            )
            return None
