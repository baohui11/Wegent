# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Web research skill helpers for skill-gated web_search / web_extract tools."""

from __future__ import annotations

import logging
from typing import Any

from chat_shell.core.config import settings

logger = logging.getLogger(__name__)

WEB_RESEARCH_SKILL_NAMES: frozenset[str] = frozenset({"web-research", "联网搜索"})
WEB_RESEARCH_SKILL_DISPLAY_NAMES: frozenset[str] = frozenset({"联网搜索"})
WEB_RESEARCH_SKILL_TAGS: frozenset[str] = frozenset({"web-research", "web-search"})


def is_web_search_platform_enabled() -> bool:
    """Return True when chat_shell web search backend integration is enabled."""
    return bool(getattr(settings, "WEB_SEARCH_ENABLED", False))


def is_web_research_skill(skill_config: dict[str, Any]) -> bool:
    """Identify the web-research guidance skill from skill metadata."""
    name = str(skill_config.get("name") or "").strip()
    if name in WEB_RESEARCH_SKILL_NAMES:
        return True

    display_name = str(
        skill_config.get("displayName") or skill_config.get("display_name") or ""
    ).strip()
    if display_name in WEB_RESEARCH_SKILL_DISPLAY_NAMES:
        return True

    tags = skill_config.get("tags") or []
    if isinstance(tags, list):
        normalized_tags = {str(tag).strip().lower() for tag in tags if tag}
        if normalized_tags & WEB_RESEARCH_SKILL_TAGS:
            return True

    return False


def create_web_research_tools(
    *,
    search_engine: str | None = None,
    default_max_results: int | None = None,
) -> list[Any]:
    """Create built-in web search tools for skill-gated registration."""
    from chat_shell.tools.builtin import WebExtractTool, WebSearchTool

    effective_max_results = default_max_results
    if effective_max_results is None:
        effective_max_results = getattr(settings, "WEB_SEARCH_DEFAULT_MAX_RESULTS", 5)

    return [
        WebSearchTool(
            engine_name=search_engine,
            default_max_results=effective_max_results,
        ),
        WebExtractTool(),
    ]


def register_web_research_tools_for_skills(
    skill_configs: list[dict[str, Any]],
    *,
    load_skill_tool: Any,
    preload_skills: list[str] | None,
    search_engine: str | None,
    immediate_tools: list[Any],
) -> None:
    """Register web_search/web_extract under matching skills when platform search is on."""
    if load_skill_tool is None or not is_web_search_platform_enabled():
        return

    default_max_results = getattr(settings, "WEB_SEARCH_DEFAULT_MAX_RESULTS", 5)
    preload_set = set(preload_skills or [])

    for skill_config in skill_configs:
        if not is_web_research_skill(skill_config):
            continue

        skill_name = str(skill_config.get("name") or "unknown")
        web_tools = create_web_research_tools(
            search_engine=search_engine,
            default_max_results=default_max_results,
        )

        existing = load_skill_tool.get_skill_tools(skill_name)
        merged_tools = _merge_tools_by_name(list(existing) + web_tools)
        load_skill_tool.register_skill_tools(skill_name, merged_tools)

        if skill_name in preload_set:
            immediate_tools.extend(web_tools)

        logger.info(
            "[web_research_skill] Registered %d tool(s) for skill '%s' (preload=%s): %s",
            len(web_tools),
            skill_name,
            skill_name in preload_set,
            [getattr(tool, "name", "?") for tool in web_tools],
        )


def _merge_tools_by_name(tools: list[Any]) -> list[Any]:
    merged: list[Any] = []
    seen: set[str] = set()
    for tool in tools:
        name = getattr(tool, "name", None)
        if isinstance(name, str) and name:
            if name in seen:
                continue
            seen.add(name)
        merged.append(tool)
    return merged
