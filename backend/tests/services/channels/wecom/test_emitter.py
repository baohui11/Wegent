# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for WeComStreamEmitter."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.channels.wecom.emitter import WeComStreamEmitter
from shared.models import EventType, ExecutionEvent


@pytest.mark.asyncio
async def test_emit_chunk_force_publishes_full_overwrite():
    pub = AsyncMock()
    with patch("app.services.channels.wecom.emitter.publish_reply", pub):
        em = WeComStreamEmitter(bot_id="b", req_id="r", stream_id="s")
        # First chunk publishes immediately because _last_update=0.0; force=True
        # is needed for subsequent chunks to bypass the throttle interval.
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


@pytest.mark.asyncio
async def test_emit_cancelled_publishes_finish_frame():
    """emit() with CANCELLED event must publish a finish=True frame."""
    pub = AsyncMock()
    with patch("app.services.channels.wecom.emitter.publish_reply", pub):
        em = WeComStreamEmitter(bot_id="b", req_id="r", stream_id="s")
        event = ExecutionEvent.create(
            event_type=EventType.CANCELLED,
            task_id=1,
            subtask_id=1,
        )
        await em.emit(event)

    assert pub.await_count == 1
    frame = pub.await_args_list[0].args[1]
    assert frame.payload["stream"]["finish"] is True


@pytest.mark.asyncio
async def test_emit_cancelled_is_idempotent():
    """emit_cancelled() called twice must publish only once."""
    pub = AsyncMock()
    with patch("app.services.channels.wecom.emitter.publish_reply", pub):
        em = WeComStreamEmitter(bot_id="b", req_id="r", stream_id="s")
        await em.emit_cancelled(task_id=1, subtask_id=1)
        count_after_first = len(pub.await_args_list)
        await em.emit_cancelled(task_id=1, subtask_id=1)
        assert len(pub.await_args_list) == count_after_first


@pytest.mark.asyncio
async def test_emit_error_publishes_finish_frame():
    """emit_error() must publish a finish=True frame."""
    pub = AsyncMock()
    with patch("app.services.channels.wecom.emitter.publish_reply", pub):
        em = WeComStreamEmitter(bot_id="b", req_id="r", stream_id="s")
        await em.emit_error(task_id=1, subtask_id=1, error="something went wrong")

    assert pub.await_count == 1
    frame = pub.await_args_list[0].args[1]
    assert frame.payload["stream"]["finish"] is True


@pytest.mark.asyncio
async def test_emit_error_is_idempotent():
    """emit_error() called twice must publish only once."""
    pub = AsyncMock()
    with patch("app.services.channels.wecom.emitter.publish_reply", pub):
        em = WeComStreamEmitter(bot_id="b", req_id="r", stream_id="s")
        await em.emit_error(task_id=1, subtask_id=1, error="boom")
        count_after_first = len(pub.await_args_list)
        await em.emit_error(task_id=1, subtask_id=1, error="boom")
        assert len(pub.await_args_list) == count_after_first
