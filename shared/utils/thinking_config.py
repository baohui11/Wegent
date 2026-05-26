# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Utilities for provider-native thinking/reasoning configuration."""

from __future__ import annotations

import copy
from typing import Any, Dict, Optional


def is_thinking_enabled_by_default(think_config: Optional[Dict[str, Any]]) -> bool:
    """Return whether think_config represents enabled reasoning by default."""
    if not think_config:
        return False

    thinking = think_config.get("thinking")
    if isinstance(thinking, dict):
        thinking_type = thinking.get("type")
        if thinking_type is not None:
            return str(thinking_type).lower() == "enabled"

    reasoning_effort = think_config.get("reasoning_effort")
    if reasoning_effort is not None:
        return str(reasoning_effort).lower() not in {"none", "off", "disabled"}

    # Non-empty think_config without explicit disable is treated as enabled.
    return True


def apply_thinking_toggle(
    think_config: Dict[str, Any], enabled: bool
) -> Dict[str, Any]:
    """Return a copy of think_config with reasoning enabled or disabled."""
    config = copy.deepcopy(think_config)

    if "thinking" in config and isinstance(config["thinking"], dict):
        config["thinking"] = {
            **config["thinking"],
            "type": "enabled" if enabled else "disabled",
        }
    elif "reasoning_effort" in config:
        config["reasoning_effort"] = "medium" if enabled else "none"
    elif enabled:
        config["thinking"] = {"type": "enabled"}
    else:
        config["thinking"] = {"type": "disabled"}

    return config
