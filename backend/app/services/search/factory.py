# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Factory for creating search service instances based on configuration.
"""

import json
import logging
from typing import Any

from app.core.config import settings

from .base import SearchServiceBase
from .bocha_search import DEFAULT_BOCHA_WEB_SEARCH_URL, BochaSearchService
from .http_search import HttpSearchService
from .tavily_extract import TavilyExtractService
from .tavily_search import TavilySearchService

logger = logging.getLogger(__name__)

# Cache for search service instances and config
_search_services: dict[str, SearchServiceBase] = {}
_tavily_extract_service: TavilyExtractService | None = None
_engines_config: dict[str, Any] | None = None


def _get_engines_config() -> dict[str, Any] | None:
    """Parse and cache the engines configuration from settings."""
    global _engines_config
    if _engines_config is not None:
        logger.debug("Using cached engines configuration")
        return _engines_config

    if not getattr(settings, "WEB_SEARCH_ENABLED", False):
        logger.info("Web search is disabled")
        return None

    config_str = getattr(settings, "WEB_SEARCH_ENGINES", "")
    if not config_str:
        return None

    try:
        _engines_config = json.loads(config_str)
        logger.debug(
            "Parsed engines configuration with %d engines",
            len(_engines_config.get("engines", {})),
        )
        return _engines_config
    except json.JSONDecodeError:
        logger.exception("Failed to parse WEB_SEARCH_ENGINES configuration")
        return None


def _create_search_service(
    engine_name: str, engine_config: dict[str, Any]
) -> SearchServiceBase | None:
    """Create a search service instance from engine configuration."""
    engine_type = engine_config.get("type", "http").lower()

    if engine_type == "bocha":
        api_key = engine_config.get("api_key") or getattr(settings, "BOCHA_API_KEY", "")
        if not api_key:
            logger.error(
                "BOCHA_API_KEY is required for bocha search engine: %s",
                engine_name,
            )
            return None

        return BochaSearchService(
            api_key=api_key,
            base_url=engine_config.get("base_url", DEFAULT_BOCHA_WEB_SEARCH_URL),
            max_results=engine_config.get("max_results", 10),
            freshness=engine_config.get("freshness", "noLimit"),
            summary=engine_config.get("summary", True),
            timeout=engine_config.get("timeout", 15),
        )

    if engine_type == "tavily":
        api_key = engine_config.get("api_key") or getattr(
            settings, "TAVILY_API_KEY", ""
        )
        if not api_key:
            logger.error(
                "TAVILY_API_KEY is required for tavily search engine: %s",
                engine_name,
            )
            return None

        return TavilySearchService(
            api_key=api_key,
            auto_parameters=engine_config.get(
                "auto_parameters", settings.TAVILY_AUTO_PARAMETERS
            ),
            include_favicon=engine_config.get(
                "include_favicon", settings.TAVILY_INCLUDE_FAVICON
            ),
            safe_search=engine_config.get("safe_search", settings.TAVILY_SAFE_SEARCH),
            include_usage=engine_config.get(
                "include_usage", settings.TAVILY_INCLUDE_USAGE
            ),
            default_country=engine_config.get("country", settings.TAVILY_COUNTRY),
            timeout=float(engine_config.get("timeout", 60)),
        )

    base_url = engine_config.get("base_url")
    if not base_url:
        logger.error("base_url is required for search engine: %s", engine_name)
        return None

    return HttpSearchService(
        base_url=base_url,
        max_results=engine_config.get("max_results", 10),
        query_param=engine_config.get("query_param", "q"),
        limit_param=engine_config.get("limit_param", "limit"),
        auth_header=engine_config.get("auth_header", {}),
        extra_params=engine_config.get("extra_params", {}),
        response_path=engine_config.get("response_path"),
        title_field=engine_config.get("title_field", "title"),
        url_field=engine_config.get("url_field", "url"),
        snippet_field=engine_config.get("snippet_field", "snippet"),
        content_field=engine_config.get("content_field", "main_content"),
        timeout=engine_config.get("timeout", 10),
    )


def get_search_service(engine_name: str | None = None) -> SearchServiceBase | None:
    """
    Get the configured search service instance for a specific engine.
    If engine_name is None, returns the first configured engine.
    """

    config = _get_engines_config()
    if not config or "engines" not in config:
        return None

    engines = config["engines"]

    # Select engine: default from config, requested one, or first available one
    default_name = config.get("default")
    selected_name = (
        engine_name
        if engine_name and engine_name in engines
        else (
            default_name
            if default_name and default_name in engines
            else next(iter(engines), None)
        )
    )

    if not selected_name:
        return None

    # Return cached instance if available
    if selected_name in _search_services:
        return _search_services[selected_name]

    engine_config = engines[selected_name]
    service = _create_search_service(selected_name, engine_config)
    if not service:
        return None

    _search_services[selected_name] = service
    logger.info(
        "Initialized search service for engine: %s (type=%s)",
        selected_name,
        engine_config.get("type", "http"),
    )
    return service


def get_default_engine_name() -> str | None:
    """Return the configured default search engine name, if any."""
    config = _get_engines_config()
    if not config or "engines" not in config:
        return None

    engines = config["engines"]
    default_name = config.get("default")
    if default_name and default_name in engines:
        return default_name

    return next(iter(engines), None)


def get_available_engines() -> list[dict[str, str]]:
    """Get list of available search engines."""
    config = _get_engines_config()
    if not config or "engines" not in config:
        return []
    return [
        {"name": k, "display_name": v.get("display_name", k)}
        for k, v in config["engines"].items()
    ]


def _resolve_tavily_api_key() -> str:
    """Resolve Tavily API key from engine config or settings."""
    config = _get_engines_config()
    if config and "engines" in config:
        default_name = get_default_engine_name()
        if default_name:
            engine_config = config["engines"].get(default_name, {})
            if engine_config.get("type", "").lower() == "tavily":
                api_key = engine_config.get("api_key") or ""
                if api_key:
                    return api_key
        for engine_config in config["engines"].values():
            if engine_config.get("type", "").lower() == "tavily":
                api_key = engine_config.get("api_key") or ""
                if api_key:
                    return api_key

    return getattr(settings, "TAVILY_API_KEY", "")


def get_tavily_extract_service() -> TavilyExtractService | None:
    """Get Tavily extract service when web search is enabled and API key is set."""
    global _tavily_extract_service

    if not getattr(settings, "WEB_SEARCH_ENABLED", False):
        return None

    api_key = _resolve_tavily_api_key()
    if not api_key:
        logger.info("Tavily extract unavailable: TAVILY_API_KEY not configured")
        return None

    if _tavily_extract_service is not None:
        return _tavily_extract_service

    _tavily_extract_service = TavilyExtractService(
        api_key=api_key,
        include_favicon=getattr(settings, "TAVILY_INCLUDE_FAVICON", True),
        include_usage=getattr(settings, "TAVILY_INCLUDE_USAGE", True),
    )
    logger.info("Initialized Tavily extract service")
    return _tavily_extract_service
