# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Internal web search API for chat_shell HTTP mode."""

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.auth.internal_service_token import verify_internal_service_token
from app.services.search.factory import get_search_service, get_tavily_extract_service
from app.services.search.tavily_extract import TAVILY_EXTRACT_MAX_URLS

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/web-search",
    tags=["internal-web-search"],
    dependencies=[Depends(verify_internal_service_token)],
)


class WebSearchRequest(BaseModel):
    """Request body for internal web search."""

    query: str = Field(..., min_length=1, description="Search query")
    engine_name: Optional[str] = Field(
        None, description="Search engine name (uses default if omitted)"
    )
    limit: int = Field(default=10, ge=1, le=10, description="Maximum results")
    country: Optional[str] = Field(
        default=None,
        description=(
            "Country hint for regional results (ISO code like CN or Tavily name like china). "
            "Omit to use server default. Pass empty string for global search."
        ),
    )


class WebSearchResponse(BaseModel):
    """Response body for internal web search."""

    query: str
    results: list[dict[str, Any]]
    count: int


@router.post("/search", response_model=WebSearchResponse)
async def search_web(request: WebSearchRequest) -> WebSearchResponse:
    """Execute web search using backend-configured search engines."""
    if not settings.WEB_SEARCH_ENABLED:
        raise HTTPException(status_code=400, detail="Web search is disabled")

    search_service = get_search_service(request.engine_name)
    if not search_service:
        raise HTTPException(
            status_code=400,
            detail="Search service not configured",
        )

    logger.info(
        "Internal web search: engine=%s query=%s",
        request.engine_name or "default",
        request.query[:50],
    )

    try:
        raw_results = await search_service.search_raw(
            query=request.query,
            limit=request.limit,
            country=request.country,
        )
    except Exception as exc:
        logger.exception("Internal web search failed")
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    formatted_results = [
        {
            "title": result.get("title", ""),
            "url": result.get("url", ""),
            "snippet": result.get("snippet", ""),
            "content": result.get("content", ""),
        }
        for result in raw_results
    ]

    return WebSearchResponse(
        query=request.query,
        results=formatted_results,
        count=len(formatted_results),
    )


class WebExtractRequest(BaseModel):
    """Request body for Tavily web page extraction."""

    urls: list[str] = Field(
        ...,
        min_length=1,
        max_length=TAVILY_EXTRACT_MAX_URLS,
        description="URLs to extract content from",
    )


@router.post("/extract")
async def extract_web(request: WebExtractRequest) -> dict[str, Any]:
    """Extract web page content using Tavily Extract API."""
    if not settings.WEB_SEARCH_ENABLED:
        raise HTTPException(status_code=400, detail="Web search is disabled")

    extract_service = get_tavily_extract_service()
    if not extract_service:
        raise HTTPException(
            status_code=400,
            detail="Tavily extract service not configured",
        )

    logger.info(
        "Internal web extract: url_count=%d first_url=%s",
        len(request.urls),
        request.urls[0][:80] if request.urls else "",
    )

    try:
        return await extract_service.extract_urls(request.urls)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Internal web extract failed")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
