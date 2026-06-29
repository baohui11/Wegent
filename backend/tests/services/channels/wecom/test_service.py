# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.channels.wecom import protocol as p
from app.services.channels.wecom.service import WeComChannelProvider


def _channel(bot_id="b", secret="s"):
    ch = MagicMock()
    ch.id = 5
    ch.name = "wecom-test"
    ch.channel_type = "wechat"
    ch.is_enabled = True
    ch.config = {"bot_id": bot_id, "connection_secret": secret}
    ch.default_team_id = 1
    ch.default_model_name = ""
    return ch


def test_not_configured_when_missing_secret():
    provider = WeComChannelProvider(_channel(secret=""))
    assert provider._is_configured() is False


@pytest.mark.asyncio
async def test_start_returns_false_when_not_configured():
    provider = WeComChannelProvider(_channel(secret=""))
    ok = await provider.start()
    assert ok is False


@pytest.mark.asyncio
async def test_handle_frame_dedups_and_delegates():
    provider = WeComChannelProvider(_channel())
    provider._handler.handle_message = AsyncMock()
    frame = p.WeComFrame(command=p.CMD_MSG_CALLBACK, req_id="dup-1", payload={})

    with patch(
        "app.services.channels.wecom.service.cache_manager.setnx",
        AsyncMock(return_value=True),
    ):
        await provider._handle_frame(frame)
    provider._handler.handle_message.assert_awaited_once_with(frame)

    # Second time: setnx returns False (duplicate) -> not delegated again
    provider._handler.handle_message.reset_mock()
    with patch(
        "app.services.channels.wecom.service.cache_manager.setnx",
        AsyncMock(return_value=False),
    ):
        await provider._handle_frame(frame)
    provider._handler.handle_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_on_reply_frame_writes_to_ws():
    provider = WeComChannelProvider(_channel())
    fake_ws = AsyncMock()
    provider._ws = fake_ws
    frame = p.build_stream_reply("r", "s", "hi", finish=True)
    await provider._on_reply_frame(frame)
    fake_ws.send.assert_awaited_once()
    assert "hi" in fake_ws.send.await_args.args[0]


@pytest.mark.asyncio
async def test_stop_awaits_and_clears_connect_task():
    """stop() must await the connect task and null it (I-1)."""
    provider = WeComChannelProvider(_channel())

    # Assign a real long-running task to simulate a running connect loop.
    task = asyncio.create_task(asyncio.sleep(60))
    provider._connect_task = task

    await provider.stop()

    assert provider._connect_task is None
    assert task.done()
    assert task.cancelled()


@pytest.mark.asyncio
async def test_stop_on_never_started_provider_does_not_raise():
    """stop() with all fields None must be a safe no-op (I-1)."""
    provider = WeComChannelProvider(_channel())
    # All fields are None by default — should not raise.
    await provider.stop()
    assert provider._connect_task is None
    assert provider._heartbeat_task is None
    assert provider._ws is None


@pytest.mark.asyncio
async def test_ws_send_holds_lock_during_send():
    """_ws_send acquires _send_lock before calling ws.send (I-2)."""
    provider = WeComChannelProvider(_channel())
    lock_held_during_send: list[bool] = []

    async def capturing_send(data: bytes) -> None:
        lock_held_during_send.append(provider._send_lock.locked())

    fake_ws = AsyncMock()
    fake_ws.send.side_effect = capturing_send
    provider._ws = fake_ws

    await provider._ws_send(p.build_ping())

    assert lock_held_during_send == [True]


@pytest.mark.asyncio
async def test_ws_send_serializes_concurrent_writes():
    """Concurrent _ws_send calls must not overlap (I-2)."""
    provider = WeComChannelProvider(_channel())
    active: list[int] = []
    peak_concurrent: list[int] = []

    async def slow_send(data: bytes) -> None:
        active.append(1)
        peak_concurrent.append(len(active))
        await asyncio.sleep(0)  # yield so a second waiter could sneak in
        active.pop()

    fake_ws = AsyncMock()
    fake_ws.send.side_effect = slow_send
    provider._ws = fake_ws

    await asyncio.gather(
        provider._ws_send(p.build_ping()),
        provider._ws_send(p.build_ping()),
    )

    # The lock must prevent both sends from executing simultaneously.
    assert max(peak_concurrent) == 1
