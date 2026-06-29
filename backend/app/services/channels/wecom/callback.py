# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""WeCom callback service for device/cloud task execution streaming."""

import logging
from typing import TYPE_CHECKING, Any, Dict, Optional

from app.services.channels.callback import (
    BaseCallbackInfo,
    BaseChannelCallbackService,
    ChannelType,
    get_callback_registry,
)
from app.services.channels.wecom.emitter import WeComStreamEmitter

if TYPE_CHECKING:
    from app.services.execution.emitters import ResultEmitter

logger = logging.getLogger(__name__)


class WeComCallbackInfo(BaseCallbackInfo):
    """Information needed to send a callback reply to WeCom."""

    def __init__(
        self,
        channel_id: int,
        conversation_id: str,
        bot_id: Optional[str] = None,
        req_id: Optional[str] = None,
        stream_id: Optional[str] = None,
    ):
        super().__init__(
            channel_type=ChannelType.WECHAT,
            channel_id=channel_id,
            conversation_id=conversation_id,
        )
        self.bot_id = bot_id
        self.req_id = req_id
        self.stream_id = stream_id

    def to_dict(self) -> Dict[str, Any]:
        data = super().to_dict()
        data.update(
            {"bot_id": self.bot_id, "req_id": self.req_id, "stream_id": self.stream_id}
        )
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WeComCallbackInfo":
        return cls(
            channel_id=data.get("channel_id", 0),
            conversation_id=data.get("conversation_id", ""),
            bot_id=data.get("bot_id"),
            req_id=data.get("req_id"),
            stream_id=data.get("stream_id"),
        )


class WeComCallbackService(BaseChannelCallbackService[WeComCallbackInfo]):
    """Manages WeCom task callbacks and streaming updates."""

    def __init__(self):
        super().__init__(ChannelType.WECHAT)

    def _parse_callback_info(self, data: Dict[str, Any]) -> WeComCallbackInfo:
        return WeComCallbackInfo.from_dict(data)

    def _extract_thinking_display(self, thinking: Any) -> str:
        # Phase 1: WeCom stream shows answer text only, not thinking steps.
        return ""

    async def _create_emitter(
        self, task_id: int, subtask_id: int, callback_info: WeComCallbackInfo
    ) -> Optional["ResultEmitter"]:
        if not (
            callback_info.bot_id and callback_info.req_id and callback_info.stream_id
        ):
            logger.warning(
                "[WeComCallback] Missing addressing fields for task %s", task_id
            )
            return None
        return WeComStreamEmitter(
            bot_id=callback_info.bot_id,
            req_id=callback_info.req_id,
            stream_id=callback_info.stream_id,
        )


# Singleton registered with the callback registry (import triggers registration)
wecom_callback_service = WeComCallbackService()
get_callback_registry().register(ChannelType.WECHAT, wecom_callback_service)
