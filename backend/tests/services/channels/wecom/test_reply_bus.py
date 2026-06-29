import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.channels.wecom import protocol as p
from app.services.channels.wecom import reply_bus


def test_reply_channel_key():
    assert reply_bus.reply_channel("bot9") == "wecom:reply:bot9"


@pytest.mark.asyncio
async def test_publish_reply_publishes_encoded_frame():
    fake_client = AsyncMock()
    with patch(
        "app.services.channels.wecom.reply_bus.cache_manager._get_client",
        AsyncMock(return_value=fake_client),
    ):
        frame = p.build_stream_reply("r1", "s1", "hello", finish=True)
        await reply_bus.publish_reply("botA", frame)

    fake_client.publish.assert_awaited_once()
    channel_arg, payload_arg = fake_client.publish.await_args.args
    assert channel_arg == "wecom:reply:botA"
    decoded = p.decode_frame(payload_arg)
    assert decoded.payload["stream"]["content"] == "hello"
    fake_client.aclose.assert_awaited_once()
