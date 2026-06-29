from unittest.mock import AsyncMock, patch

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


@pytest.mark.asyncio
async def test_start_closes_client_when_subscribe_raises():
    """start() must not leak the Redis client when subscribe() raises."""
    fake_pubsub = AsyncMock()
    fake_pubsub.subscribe.side_effect = RuntimeError("subscribe failed")

    fake_client = AsyncMock()
    # pubsub() is a sync call in production; override to return fake_pubsub directly.
    fake_client.pubsub = lambda: fake_pubsub

    with patch(
        "app.services.channels.wecom.reply_bus.cache_manager._get_client",
        AsyncMock(return_value=fake_client),
    ):
        sub = reply_bus.ReplySubscription("botB", AsyncMock())
        with pytest.raises(RuntimeError, match="subscribe failed"):
            await sub.start()

    # The client must be closed despite the failure.
    fake_client.aclose.assert_awaited_once()
    # The subscription object must not hold stale references.
    assert sub._client is None
    assert sub._pubsub is None
    assert sub._task is None


@pytest.mark.asyncio
async def test_close_is_idempotent():
    """Calling close() twice must not raise."""
    fake_pubsub = AsyncMock()
    fake_client = AsyncMock()
    # pubsub() is a sync call in production; override to return fake_pubsub directly.
    fake_client.pubsub = lambda: fake_pubsub

    with patch(
        "app.services.channels.wecom.reply_bus.cache_manager._get_client",
        AsyncMock(return_value=fake_client),
    ):
        sub = await reply_bus.ReplySubscription("botC", AsyncMock()).start()

    await sub.close()
    # Second close must be a safe no-op.
    await sub.close()
