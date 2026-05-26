# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for thinking config utilities."""

from shared.utils.thinking_config import (
    apply_thinking_toggle,
    is_thinking_enabled_by_default,
)


def test_is_thinking_enabled_by_default_with_enabled_type():
    assert is_thinking_enabled_by_default({"thinking": {"type": "enabled"}}) is True


def test_is_thinking_enabled_by_default_with_disabled_type():
    assert is_thinking_enabled_by_default({"thinking": {"type": "disabled"}}) is False


def test_apply_thinking_toggle_updates_thinking_type():
    config = {"thinking": {"type": "enabled", "budget_tokens": 8192}}

    disabled = apply_thinking_toggle(config, False)
    enabled = apply_thinking_toggle(disabled, True)

    assert disabled["thinking"]["type"] == "disabled"
    assert disabled["thinking"]["budget_tokens"] == 8192
    assert enabled["thinking"]["type"] == "enabled"


def test_apply_thinking_toggle_updates_reasoning_effort():
    config = {"reasoning_effort": "high"}

    assert apply_thinking_toggle(config, False)["reasoning_effort"] == "none"
    assert apply_thinking_toggle(config, True)["reasoning_effort"] == "medium"
