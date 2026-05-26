# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for streaming block storage behavior."""

import json

import pytest

from app.services.chat.storage.session import SessionManager


class FakeRedisClient:
    def __init__(self):
        self.lists = {}
        self.values = {}

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value, ex=None):
        self.values[key] = value
        return True

    async def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)
            self.lists.pop(key, None)
        return len(keys)

    async def rpush(self, key, value):
        self.lists.setdefault(key, []).append(value)
        return len(self.lists[key])

    async def lrange(self, key, start, end):
        values = self.lists.get(key, [])
        if end == -1:
            return values[start:]
        return values[start : end + 1]

    async def lset(self, key, index, value):
        self.lists[key][index] = value
        return True

    async def expire(self, key, ttl):
        return True

    async def append(self, key, value):
        current = self.values.get(key, "")
        if isinstance(current, bytes):
            current = current.decode()
        updated = f"{current}{value}"
        self.values[key] = updated
        return len(updated)

    async def aclose(self):
        return None


class FakeCache:
    def __init__(self, redis_client):
        self.redis_client = redis_client

    async def _get_client(self):
        return self.redis_client


@pytest.mark.asyncio
async def test_add_tool_block_is_idempotent_by_tool_use_id():
    manager = SessionManager()
    redis_client = FakeRedisClient()
    manager._cache = FakeCache(redis_client)

    await manager.add_tool_block(
        subtask_id=202,
        tool_use_id="Bash_1",
        tool_name="Bash",
        tool_input={"command": "pwd"},
        tool_protocol="function_call",
    )
    await manager.add_tool_block(
        subtask_id=202,
        tool_use_id="Bash_1",
        tool_name="Bash",
        tool_input={"command": "pwd"},
        tool_protocol="function_call",
    )

    blocks = await manager.get_blocks(202)

    assert len(blocks) == 1
    assert blocks[0]["tool_use_id"] == "Bash_1"
    assert blocks[0]["tool_name"] == "Bash"
    assert blocks[0]["tool_input"] == {"command": "pwd"}
    assert blocks[0]["tool_protocol"] == "function_call"
    assert json.loads(redis_client.lists["chat:streaming:blocks:202"][0]) == blocks[0]


@pytest.mark.asyncio
async def test_add_thinking_content_appends_to_same_block():
    manager = SessionManager()
    redis_client = FakeRedisClient()
    manager._cache = FakeCache(redis_client)

    block1, is_new1 = await manager.add_thinking_content(303, "step one")
    block2, is_new2 = await manager.add_thinking_content(303, " step two")

    assert is_new1 is True
    assert is_new2 is False
    assert block2["content"] == "step one step two"
    assert block2["status"] == "streaming"

    blocks = await manager.get_blocks(303)
    assert len(blocks) == 1
    assert blocks[0]["type"] == "thinking"


@pytest.mark.asyncio
async def test_tool_start_finalizes_thinking_block():
    manager = SessionManager()
    redis_client = FakeRedisClient()
    manager._cache = FakeCache(redis_client)

    await manager.add_thinking_content(404, "reasoning")
    await manager.add_tool_block(
        subtask_id=404,
        tool_use_id="Search_1",
        tool_name="web_search",
        tool_input={"query": "test"},
    )

    blocks = await manager.get_blocks(404)
    assert len(blocks) == 2
    assert blocks[0]["type"] == "thinking"
    assert blocks[0]["status"] == "done"
    assert blocks[1]["type"] == "tool"

    finalized = await manager.finalize_and_get_blocks(404)
    assert finalized[0]["status"] == "done"


@pytest.mark.asyncio
async def test_text_content_finalizes_thinking_block():
    manager = SessionManager()
    redis_client = FakeRedisClient()
    manager._cache = FakeCache(redis_client)

    await manager.add_thinking_content(505, "reasoning")
    await manager.add_text_content(505, "Hello")

    blocks = await manager.get_blocks(505)
    assert len(blocks) == 2
    assert blocks[0]["type"] == "thinking"
    assert blocks[0]["status"] == "done"
    assert blocks[1]["type"] == "text"
    assert blocks[1]["content"] == "Hello"

    finalized = await manager.finalize_and_get_blocks(505)
    assert finalized[0]["status"] == "done"
    assert finalized[1]["status"] == "done"
