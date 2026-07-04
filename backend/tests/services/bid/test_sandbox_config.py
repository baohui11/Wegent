# SPDX-License-Identifier: Apache-2.0
from app.services.bid.sandbox_config import (
    SYNTHETIC_BASE,
    build_bot_config,
    synthetic_task_id,
)


def test_synthetic_task_id_offset():
    assert synthetic_task_id(30) == SYNTHETIC_BASE + 30
    assert synthetic_task_id(30) > 1_000_000_000  # disjoint from real task ids


def test_build_bot_config_maps_anthropic_env():
    cfg = {
        "model_id": "mimo-v2.5",
        "base_url": "https://token-plan-cn.xiaomimimo.com/anthropic",
        "api_key": "tp-xxx",
    }
    bot = build_bot_config("mimo-v2.5", cfg)
    env = bot["env"]
    assert env["model"] == "claude"  # gate: triggers ANTHROPIC_* injection
    assert env["model_id"] == "mimo-v2.5"
    assert env["base_url"] == cfg["base_url"]
    assert env["api_key"] == "tp-xxx"


def test_build_bot_config_requires_credentials():
    import pytest

    with pytest.raises(ValueError):
        build_bot_config("m", {"model_id": "m"})  # no api_key/base_url
