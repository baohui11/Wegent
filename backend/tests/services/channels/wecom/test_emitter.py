# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for WeComStreamEmitter."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.channels.wecom.emitter import WeComStreamEmitter


@pytest.mark.asyncio
async def test_emit_chunk_force_publishes_full_overwrite():
    pub = AsyncMock()
    with patch("app.services.channels.wecom.emitter.publish_reply", pub):
        em = WeComStreamEmitter(bot_id="b", req_id="r", stream_id="s")
        # Bypass throttle for deterministic test
        await em.emit_chunk(task_id=1, subtask_id=1, content="Hello ", offset=0)
        await em._flush(force=True)
        await em.emit_chunk(task_id=1, subtask_id=1, content="World", offset=6)
        await em._flush(force=True)

    # Last publish carries the FULL accumulated content (overwrite semantics)
    last_frame = pub.await_args_list[-1].args[1]
    assert last_frame.payload["stream"]["content"] == "Hello World"
    assert last_frame.payload["stream"]["finish"] is False


@pytest.mark.asyncio
async def test_emit_done_sets_finish_and_uses_longer_result():
    pub = AsyncMock()
    with patch("app.services.channels.wecom.emitter.publish_reply", pub):
        em = WeComStreamEmitter(bot_id="b", req_id="r", stream_id="s")
        await em.emit_chunk(task_id=1, subtask_id=1, content="short", offset=0)
        await em.emit_done(
            task_id=1, subtask_id=1, result={"value": "a much longer final answer"}
        )

    final_frame = pub.await_args_list[-1].args[1]
    assert final_frame.payload["stream"]["finish"] is True
    assert final_frame.payload["stream"]["content"] == "a much longer final answer"


@pytest.mark.asyncio
async def test_emit_done_is_idempotent():
    pub = AsyncMock()
    with patch("app.services.channels.wecom.emitter.publish_reply", pub):
        em = WeComStreamEmitter(bot_id="b", req_id="r", stream_id="s")
        await em.emit_done(task_id=1, subtask_id=1, result={"value": "x"})
        count_after_first = len(pub.await_args_list)
        await em.emit_done(task_id=1, subtask_id=1, result={"value": "x"})
        assert len(pub.await_args_list) == count_after_first
