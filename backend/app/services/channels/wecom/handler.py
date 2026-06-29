# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""WeCom channel handler: parse frames and reply over the long connection."""

import logging
import re
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from app.models.user import User
from app.services.channels.callback import BaseChannelCallbackService, ChannelType
from app.services.channels.handler import BaseChannelHandler, MessageContext
from app.services.channels.wecom import protocol as p
from app.services.channels.wecom.callback import (
    WeComCallbackInfo,
    wecom_callback_service,
)
from app.services.channels.wecom.emitter import WeComStreamEmitter
from app.services.channels.wecom.reply_bus import publish_reply
from app.services.channels.wecom.user_resolver import WeComUserResolver
from app.services.subscription.notification_service import (
    subscription_notification_service,
)

logger = logging.getLogger(__name__)

# In group chats the inbound text always carries the bot @-mention prefix
# (e.g. "@RobotName hello"); strip the leading mention so it doesn't pollute
# the prompt. Only the first leading mention token is removed.
_LEADING_MENTION_RE = re.compile(r"^@\S+\s+")


class WeComChannelHandler(BaseChannelHandler[p.WeComFrame, WeComCallbackInfo]):
    """WeCom-specific implementation of BaseChannelHandler."""

    def __init__(
        self,
        channel_id: int,
        bot_id: str,
        get_default_team_id: Optional[Callable[[], Optional[int]]] = None,
        get_default_model_name: Optional[Callable[[], Optional[str]]] = None,
        get_user_mapping_config: Optional[Callable[[], Dict[str, Any]]] = None,
    ):
        super().__init__(
            channel_type=ChannelType.WECHAT,
            channel_id=channel_id,
            get_default_team_id=get_default_team_id,
            get_default_model_name=get_default_model_name,
            get_user_mapping_config=get_user_mapping_config,
        )
        self._bot_id = bot_id

    def parse_message(self, raw_data: Any) -> MessageContext:
        """Parse a WeComFrame (aibot_msg_callback) into a MessageContext."""
        frame: p.WeComFrame = raw_data
        payload = frame.payload or {}
        content = ""
        if payload.get("msgtype") == "text":
            content = (payload.get("text") or {}).get("content", "").strip()

        userid = (payload.get("from") or {}).get("userid", "") or ""
        chattype = payload.get("chattype", "single")
        is_group = chattype == "group"
        if is_group and content.startswith("@"):
            content = _LEADING_MENTION_RE.sub("", content, count=1).strip()
        conversation_id = payload.get("chatid") if is_group else userid
        stream_id = (payload.get("stream") or {}).get("id") or frame.req_id

        return MessageContext(
            content=content,
            sender_id=userid,
            sender_name=(payload.get("from") or {}).get("name"),
            conversation_id=conversation_id or "",
            conversation_type="group" if is_group else "private",
            is_mention=is_group,  # group messages reach the bot only via @-mention
            raw_message=frame,
            extra_data={
                "bot_id": self._bot_id,
                "req_id": frame.req_id,
                "stream_id": stream_id,
            },
            images=[],
            files=[],
        )

    async def resolve_user(
        self, db: Session, message_context: MessageContext
    ) -> Optional[User]:
        """Resolve a WeCom userid to a Wegent User and record the binding."""
        mapping = self.user_mapping_config
        resolver = WeComUserResolver(
            db,
            user_mapping_mode=mapping.mode,
            user_mapping_config=mapping.config,
        )
        user = await resolver.resolve_user(
            userid=message_context.sender_id, name=message_context.sender_name
        )
        if user is not None:
            # Record the inbound WeCom userid -> Wegent user binding so active
            # push can address this user (used for non-staff_id mapping modes).
            try:
                subscription_notification_service.update_user_im_binding(
                    db,
                    user_id=user.id,
                    channel_id=self._channel_id,
                    channel_type="wecom",
                    sender_id=message_context.sender_id,
                    sender_staff_id=None,
                    conversation_id=message_context.conversation_id,
                )
            except Exception:
                self.logger.exception("[WeComHandler] Failed to record IM binding")
        return user

    def _emitter_for(self, message_context: MessageContext) -> WeComStreamEmitter:
        """Build a WeComStreamEmitter from the context's extra_data."""
        extra = message_context.extra_data
        return WeComStreamEmitter(
            bot_id=extra["bot_id"],
            req_id=extra["req_id"],
            stream_id=extra["stream_id"],
        )

    async def send_text_reply(self, message_context: MessageContext, text: str) -> bool:
        """Publish a single finish=True frame as a text reply."""
        extra = message_context.extra_data
        frame = p.build_stream_reply(
            req_id=extra["req_id"],
            stream_id=extra["stream_id"],
            content=text,
            finish=True,
        )
        try:
            await publish_reply(extra["bot_id"], frame)
            return True
        except Exception:
            logger.exception("[WeComHandler] Failed to publish text reply")
            return False

    def create_callback_info(
        self, message_context: MessageContext
    ) -> WeComCallbackInfo:
        """Create a WeComCallbackInfo from the current message context."""
        extra = message_context.extra_data
        return WeComCallbackInfo(
            channel_id=self._channel_id,
            conversation_id=message_context.conversation_id,
            bot_id=extra.get("bot_id"),
            req_id=extra.get("req_id"),
            stream_id=extra.get("stream_id"),
        )

    def get_callback_service(self) -> Optional[BaseChannelCallbackService]:
        """Return the WeCom callback service singleton."""
        return wecom_callback_service

    async def create_streaming_emitter(
        self, message_context: MessageContext
    ) -> Optional[Any]:
        """Create a WeComStreamEmitter for real-time streaming updates."""
        return self._emitter_for(message_context)
