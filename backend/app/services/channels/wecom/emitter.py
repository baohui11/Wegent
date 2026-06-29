# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""WeCom streaming reply emitter (full-overwrite semantics)."""

import logging
import time
from typing import Optional

from app.services.channels.wecom.protocol import build_stream_reply
from app.services.channels.wecom.reply_bus import publish_reply
from shared.models import EventType, ExecutionEvent

logger = logging.getLogger(__name__)


class WeComStreamEmitter:
    """Implements the ResultEmitter protocol for WeCom long-connection streaming.

    Replies are published to the Redis reply bus (never written to the WS
    directly), so any pod can drive a stream owned by another pod.
    """

    MIN_UPDATE_INTERVAL = 0.8

    def __init__(self, bot_id: str, req_id: str, stream_id: str):
        self._bot_id = bot_id
        self._req_id = req_id
        self._stream_id = stream_id
        self._content = ""
        self._last_update = 0.0
        self._finished = False

    async def _flush(self, force: bool = False) -> None:
        if self._finished:
            return
        now = time.time()
        if not force and (now - self._last_update) < self.MIN_UPDATE_INTERVAL:
            return
        frame = build_stream_reply(
            req_id=self._req_id,
            stream_id=self._stream_id,
            content=self._content,
            finish=False,
        )
        await publish_reply(self._bot_id, frame)
        self._last_update = now

    async def emit(self, event: ExecutionEvent) -> None:
        if event.type == EventType.START:
            await self.emit_start(task_id=event.task_id, subtask_id=event.subtask_id)
        elif event.type == EventType.CHUNK:
            await self.emit_chunk(
                task_id=event.task_id,
                subtask_id=event.subtask_id,
                content=event.content or "",
                offset=event.offset,
            )
        elif event.type == EventType.DONE:
            await self.emit_done(
                task_id=event.task_id,
                subtask_id=event.subtask_id,
                result=event.result,
            )
        elif event.type == EventType.ERROR:
            await self.emit_error(
                task_id=event.task_id,
                subtask_id=event.subtask_id,
                error=event.error or "Unknown error",
            )

    async def emit_start(self, task_id: int, subtask_id: int, **kwargs) -> None:
        logger.info("[WeComEmitter] start task=%s subtask=%s", task_id, subtask_id)

    async def emit_chunk(
        self, task_id: int, subtask_id: int, content: str, offset: int, **kwargs
    ) -> None:
        if not content:
            return
        self._content += content
        await self._flush(force=False)

    async def emit_done(
        self, task_id: int, subtask_id: int, result: Optional[dict] = None, **kwargs
    ) -> None:
        if self._finished:
            return
        final_content = self._content
        if result and isinstance(result, dict):
            value = result.get("value", "")
            if value and len(value) > len(final_content):
                final_content = value
        self._content = final_content
        frame = build_stream_reply(
            req_id=self._req_id,
            stream_id=self._stream_id,
            content=final_content,
            finish=True,
        )
        await publish_reply(self._bot_id, frame)
        self._finished = True

    async def emit_error(
        self, task_id: int, subtask_id: int, error: str, **kwargs
    ) -> None:
        if self._finished:
            return
        content = (self._content + f"\n\n❌ 执行出错: {error}").strip()
        frame = build_stream_reply(
            req_id=self._req_id,
            stream_id=self._stream_id,
            content=content,
            finish=True,
        )
        await publish_reply(self._bot_id, frame)
        self._finished = True

    async def emit_cancelled(self, task_id: int, subtask_id: int, **kwargs) -> None:
        if self._finished:
            return
        content = (self._content + "\n\n⚠️ 任务已取消").strip()
        frame = build_stream_reply(
            req_id=self._req_id,
            stream_id=self._stream_id,
            content=content,
            finish=True,
        )
        await publish_reply(self._bot_id, frame)
        self._finished = True

    async def close(self) -> None:
        # No persistent resources; finalize if still open.
        if not self._finished:
            self._finished = True
