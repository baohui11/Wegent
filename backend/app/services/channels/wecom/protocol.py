# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""WeCom smart-bot long-connection protocol frame codec.

Thin dict<->dataclass mapping for the WeCom AI-bot WebSocket protocol.
Keeping all wire details here means a wire-format change touches only this
module and its tests.
"""

import json
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

# Protocol command names
CMD_SUBSCRIBE = "aibot_subscribe"
CMD_PING = "ping"
CMD_PONG = "pong"
CMD_MSG_CALLBACK = "aibot_msg_callback"
CMD_RESPOND = "aibot_respond_msg"
CMD_EVENT_CALLBACK = "aibot_event_callback"

# WeCom stream.content hard cap (bytes)
STREAM_CONTENT_MAX_BYTES = 20480
_TRUNCATE_SUFFIX = "…(内容过长已截断)"


@dataclass
class WeComFrame:
    """A decoded protocol frame."""

    command: str
    req_id: Optional[str] = None
    payload: Dict[str, Any] = field(default_factory=dict)


def encode_frame(frame: WeComFrame) -> str:
    """Encode a frame to JSON text for the WebSocket."""
    envelope: Dict[str, Any] = {"command": frame.command, "payload": frame.payload}
    if frame.req_id is not None:
        envelope["headers"] = {"req_id": frame.req_id}
    return json.dumps(envelope, ensure_ascii=False)


def decode_frame(raw: str) -> WeComFrame:
    """Decode JSON text from the WebSocket into a frame."""
    data = json.loads(raw)
    headers = data.get("headers") or {}
    return WeComFrame(
        command=data.get("command", ""),
        req_id=headers.get("req_id"),
        payload=data.get("payload") or {},
    )


def build_subscribe(bot_id: str, secret: str) -> WeComFrame:
    """Build the subscription/auth frame sent right after connecting."""
    return WeComFrame(
        command=CMD_SUBSCRIBE,
        payload={"bot_id": bot_id, "secret": secret},
    )


def build_ping() -> WeComFrame:
    """Build a heartbeat ping frame."""
    return WeComFrame(command=CMD_PING)


def truncate_stream_content(content: str) -> str:
    """Truncate content to fit the WeCom stream.content byte cap."""
    encoded = content.encode("utf-8")
    if len(encoded) <= STREAM_CONTENT_MAX_BYTES:
        return content
    suffix_bytes = len(_TRUNCATE_SUFFIX.encode("utf-8"))
    budget = STREAM_CONTENT_MAX_BYTES - suffix_bytes
    # Cut on a UTF-8 boundary
    clipped = encoded[:budget].decode("utf-8", errors="ignore")
    return clipped + _TRUNCATE_SUFFIX


def build_stream_reply(
    req_id: str, stream_id: str, content: str, finish: bool
) -> WeComFrame:
    """Build a full-overwrite streaming reply frame."""
    return WeComFrame(
        command=CMD_RESPOND,
        req_id=req_id,
        payload={
            "msgtype": "stream",
            "stream": {
                "id": stream_id,
                "finish": finish,
                "content": truncate_stream_content(content),
            },
        },
    )
