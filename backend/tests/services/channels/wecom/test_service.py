# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

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
