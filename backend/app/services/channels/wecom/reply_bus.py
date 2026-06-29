# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Redis pub/sub bridge for WeCom replies.

In long-connection mode a bot has exactly one WebSocket connection, owned by a
single pod. Any pod (e.g. one processing an executor callback) publishes reply
frames here; the connection-owning pod subscribes and writes them to the WS.
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
        self._client = await cache_manager._get_client()
        self._pubsub = self._client.pubsub()
        await self._pubsub.subscribe(reply_channel(self._bot_id))
        self._task = asyncio.create_task(self._run())
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
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._pubsub:
            await self._pubsub.unsubscribe(reply_channel(self._bot_id))
            await self._pubsub.aclose()
        if self._client:
            await self._client.aclose()


async def subscribe_replies(bot_id: str, on_frame: OnFrame) -> ReplySubscription:
    """Subscribe to a bot's reply channel and dispatch frames to on_frame."""
    return await ReplySubscription(bot_id, on_frame).start()
