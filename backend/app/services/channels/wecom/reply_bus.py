# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Redis pub/sub bridge for WeCom replies.

In long-connection mode a bot has exactly one WebSocket connection, owned by a
single pod. Any pod (e.g. one processing an executor callback) publishes reply
frames here; the connection-owning pod subscribes and writes them to the WS.

v1 limitation: an unhandled error inside the outer listen() loop ends the
subscription silently (logged, but not re-raised). Automatic reconnection is
future work; callers should monitor connection health independently.
"""

import asyncio
import logging
from typing import Awaitable, Callable

from app.core.cache import cache_manager
from app.services.channels.wecom import protocol as p

logger = logging.getLogger(__name__)

OnFrame = Callable[[p.WeComFrame], Awaitable[None]]


def reply_channel(bot_id: str) -> str:
    """Redis pub/sub channel name for a bot's replies."""
    return f"wecom:reply:{bot_id}"


async def publish_reply(bot_id: str, frame: p.WeComFrame) -> None:
    """Publish a reply frame to the bot's reply channel."""
    client = await cache_manager._get_client()
    try:
        await client.publish(reply_channel(bot_id), p.encode_frame(frame))
    finally:
        await client.aclose()


class ReplySubscription:
    """An active subscription that dispatches reply frames to a callback."""

    def __init__(self, bot_id: str, on_frame: OnFrame):
        self._bot_id = bot_id
        self._on_frame = on_frame
        self._client = None
        self._pubsub = None
        self._task: asyncio.Task | None = None

    async def start(self) -> "ReplySubscription":
        client = await cache_manager._get_client()
        try:
            pubsub = client.pubsub()
            await pubsub.subscribe(reply_channel(self._bot_id))
            self._client = client
            self._pubsub = pubsub
            self._task = asyncio.create_task(self._run())
        except Exception:
            # Clean up whatever was created before re-raising so we never
            # leak the Redis connection on a partial-start failure.
            try:
                await pubsub.aclose()
            except Exception:
                pass
            await client.aclose()
            raise
        return self

    async def _run(self) -> None:
        try:
            async for message in self._pubsub.listen():
                if message.get("type") != "message":
                    continue
                raw = message["data"]
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8")
                try:
                    frame = p.decode_frame(raw)
                    await self._on_frame(frame)
                except Exception:
                    logger.exception("[WeCom reply_bus] Failed to dispatch reply frame")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[WeCom reply_bus] Subscription loop error")

    async def close(self) -> None:
        """Tear down the subscription.  Safe to call more than once."""
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._pubsub is not None:
            await self._pubsub.unsubscribe(reply_channel(self._bot_id))
            await self._pubsub.aclose()
            self._pubsub = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None


async def subscribe_replies(bot_id: str, on_frame: OnFrame) -> ReplySubscription:
    """Subscribe to a bot's reply channel and dispatch frames to on_frame."""
    return await ReplySubscription(bot_id, on_frame).start()
