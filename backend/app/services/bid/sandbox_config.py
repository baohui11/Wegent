# SPDX-License-Identifier: Apache-2.0
"""Synthetic-task-id + ClaudeCode bot_config builders for bid drafting sandbox.

A bid project has no Task row; the sandbox subsystem is keyed by an integer
task_id (pure Redis, no DB lookup). We derive a synthetic id in a range
disjoint from real Task ids so it never reuses/clobbers a real task's sandbox.
"""

SYNTHETIC_BASE = 2_000_000_000


def synthetic_task_id(project_id: int) -> int:
    return SYNTHETIC_BASE + int(project_id)


def build_bot_config(model_id: str, model_config: dict | None) -> dict:
    """bot_config.env -> executor injects ANTHROPIC_MODEL/BASE_URL/AUTH_TOKEN
    (config_manager.py:167-184). ``model`` must be 'claude' to trigger it."""
    cfg = model_config or {}
    api_key = cfg.get("api_key")
    base_url = cfg.get("base_url")
    if not (api_key and base_url):
        raise ValueError(
            f"模型 '{model_id}' 未解析出有效 Anthropic 凭证（api_key/base_url）"
        )
    return {
        "env": {
            "model": "claude",
            "model_id": cfg.get("model_id") or model_id,
            "base_url": base_url,
            "api_key": api_key,
        }
    }
