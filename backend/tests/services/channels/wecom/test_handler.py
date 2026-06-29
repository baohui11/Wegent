# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.channels.wecom import protocol as p
from app.services.channels.wecom.callback import (
    WeComCallbackInfo,
    wecom_callback_service,
)
from app.services.channels.wecom.handler import WeComChannelHandler


def _msg_frame(text: str, userid: str = "u1", chattype: str = "single") -> p.WeComFrame:
    return p.WeComFrame(
        command=p.CMD_MSG_CALLBACK,
        req_id="req-1",
        payload={
            "msgtype": "text",
            "text": {"content": text},
            "from": {"userid": userid},
            "chattype": chattype,
            "chatid": "chat-9",
            "stream": {"id": "stream-1"},
        },
    )


def test_parse_message_single_text():
    h = WeComChannelHandler(channel_id=3, bot_id="botZ")
    ctx = h.parse_message(_msg_frame("hello"))
    assert ctx.content == "hello"
    assert ctx.sender_id == "u1"
    assert ctx.conversation_type == "private"
    assert ctx.extra_data["bot_id"] == "botZ"
    assert ctx.extra_data["req_id"] == "req-1"


def test_parse_message_group_sets_group_type():
    h = WeComChannelHandler(channel_id=3, bot_id="botZ")
    ctx = h.parse_message(_msg_frame("hi", chattype="group"))
    assert ctx.conversation_type == "group"
    assert ctx.conversation_id == "chat-9"


def test_parse_message_group_strips_bot_mention():
    # Real captured group content includes the bot @-mention prefix.
    h = WeComChannelHandler(channel_id=3, bot_id="botZ")
    ctx = h.parse_message(_msg_frame("@李惟夏的机器人 hello", chattype="group"))
    assert ctx.content == "hello"


def test_parse_message_single_keeps_leading_at():
    # Single chats never carry a bot mention; do not strip a leading '@'.
    h = WeComChannelHandler(channel_id=3, bot_id="botZ")
    ctx = h.parse_message(_msg_frame("@alice hi", chattype="single"))
    assert ctx.content == "@alice hi"


def test_create_callback_info_carries_addressing():
    h = WeComChannelHandler(channel_id=3, bot_id="botZ")
    ctx = h.parse_message(_msg_frame("hello"))
    info = h.create_callback_info(ctx)
    assert isinstance(info, WeComCallbackInfo)
    assert info.bot_id == "botZ"
    assert info.req_id == "req-1"


def test_get_callback_service_returns_singleton():
    h = WeComChannelHandler(channel_id=3, bot_id="botZ")
    assert h.get_callback_service() is wecom_callback_service


@pytest.mark.asyncio
async def test_send_text_reply_publishes_finish_frame():
    h = WeComChannelHandler(channel_id=3, bot_id="botZ")
    ctx = h.parse_message(_msg_frame("hello"))
    with patch("app.services.channels.wecom.handler.publish_reply", AsyncMock()) as pub:
        ok = await h.send_text_reply(ctx, "done")
    assert ok is True
    frame = pub.await_args.args[1]
    assert frame.payload["stream"]["finish"] is True
    assert frame.payload["stream"]["content"] == "done"
