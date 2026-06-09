# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for web-research skill gating of built-in search tools."""

from unittest.mock import patch

import pytest

from chat_shell.tools.builtin.load_skill import LoadSkillTool
from chat_shell.tools.web_research_skill import (
    create_web_research_tools,
    is_web_research_skill,
    register_web_research_tools_for_skills,
)


class TestWebResearchSkillDetection:
    def test_matches_skill_name(self):
        assert is_web_research_skill({"name": "web-research"})
        assert is_web_research_skill({"name": "联网搜索"})

    def test_matches_display_name(self):
        assert is_web_research_skill({"name": "custom", "displayName": "联网搜索"})

    def test_matches_tag(self):
        assert is_web_research_skill({"name": "other", "tags": ["web-research"]})

    def test_rejects_unrelated_skill(self):
        assert not is_web_research_skill({"name": "sandbox", "tags": ["sandbox"]})


class TestWebResearchSkillRegistration:
    def test_registers_tools_without_preload(self):
        load_skill_tool = LoadSkillTool(
            user_id=1,
            skill_names=["web-research"],
            skill_metadata={
                "web-research": {
                    "description": "Web research",
                    "prompt": "Use web_search first.",
                }
            },
        )
        immediate_tools: list = []

        with patch(
            "chat_shell.tools.web_research_skill.is_web_search_platform_enabled",
            return_value=True,
        ):
            register_web_research_tools_for_skills(
                [{"name": "web-research", "description": "Web research"}],
                load_skill_tool=load_skill_tool,
                preload_skills=[],
                search_engine="tavily",
                immediate_tools=immediate_tools,
            )

        registered = load_skill_tool.get_skill_tools("web-research")
        assert [tool.name for tool in registered] == ["web_search", "web_extract"]
        assert load_skill_tool.get_available_tools() == []
        assert immediate_tools == []

    def test_preloaded_skill_exposes_tools_immediately(self):
        load_skill_tool = LoadSkillTool(
            user_id=1,
            skill_names=["web-research"],
            skill_metadata={
                "web-research": {
                    "description": "Web research",
                    "prompt": "Use web_search first.",
                }
            },
        )
        immediate_tools: list = []
        skill_config = {
            "name": "web-research",
            "description": "Web research",
            "prompt": "Use web_search first.",
        }

        load_skill_tool.preload_skill_prompt("web-research", skill_config)

        with patch(
            "chat_shell.tools.web_research_skill.is_web_search_platform_enabled",
            return_value=True,
        ):
            register_web_research_tools_for_skills(
                [skill_config],
                load_skill_tool=load_skill_tool,
                preload_skills=["web-research"],
                search_engine="tavily",
                immediate_tools=immediate_tools,
            )

        assert [tool.name for tool in immediate_tools] == ["web_search", "web_extract"]
        assert {tool.name for tool in load_skill_tool.get_available_tools()} == {
            "web_search",
            "web_extract",
        }

    def test_skips_when_platform_search_disabled(self):
        load_skill_tool = LoadSkillTool(
            user_id=1,
            skill_names=["web-research"],
            skill_metadata={"web-research": {"description": "x", "prompt": "y"}},
        )
        immediate_tools: list = []

        with patch(
            "chat_shell.tools.web_research_skill.is_web_search_platform_enabled",
            return_value=False,
        ):
            register_web_research_tools_for_skills(
                [{"name": "web-research"}],
                load_skill_tool=load_skill_tool,
                preload_skills=["web-research"],
                search_engine="tavily",
                immediate_tools=immediate_tools,
            )

        assert load_skill_tool.get_skill_tools("web-research") == []
        assert immediate_tools == []


@pytest.mark.asyncio
async def test_prepare_skill_tools_registers_web_research_tools():
    from chat_shell.tools.skill_factory import prepare_skill_tools

    load_skill_tool = LoadSkillTool(
        user_id=1,
        skill_names=["web-research"],
        skill_metadata={
            "web-research": {
                "description": "Web research",
                "prompt": "Search then extract.",
            }
        },
    )

    with patch(
        "chat_shell.tools.web_research_skill.is_web_search_platform_enabled",
        return_value=True,
    ):
        tools, _clients = await prepare_skill_tools(
            task_id=1,
            subtask_id=2,
            user_id=1,
            skill_configs=[
                {
                    "name": "web-research",
                    "description": "Web research",
                    "prompt": "Search then extract.",
                }
            ],
            load_skill_tool=load_skill_tool,
            preload_skills=[],
        )

    assert [tool.name for tool in load_skill_tool.get_skill_tools("web-research")] == [
        "web_search",
        "web_extract",
    ]
    assert tools == []
    load_skill_tool._run("web-research")
    assert {tool.name for tool in load_skill_tool.get_available_tools()} == {
        "web_search",
        "web_extract",
    }


def test_create_web_research_tools_names():
    tools = create_web_research_tools(search_engine="tavily")
    assert [tool.name for tool in tools] == ["web_search", "web_extract"]
