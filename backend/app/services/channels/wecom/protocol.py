# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""WeCom smart-bot long-connection protocol frame codec.

Thin dict<->dataclass mapping for the WeCom AI-bot WebSocket protocol.
Keeping all wire details here means a wire-format change touches only this
module and its tests.

Wire envelope (verified against the live server, the official Node SDK
``WsFrame``, and community Python SDKs)::

    { "cmd": "<command>",
      "headers": { "req_id": "<id>" },
      "body": { ... },
      "errcode": 0, "errmsg": "ok" }   # only on server ack/response frames

The ``WeComFrame`` dataclass uses internal names (``command``/``payload``)
that map onto the wire fields ``cmd``/``body``; ``errcode``/``errmsg`` are
populated only when the server sends them. ``headers.req_id`` is REQUIRED on
every outbound frame, and a streaming reply MUST echo the ``req_id`` of the
callback it answers.
"""

import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

# Protocol command names (wire value of the top-level ``cmd`` field)
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
    """A decoded protocol frame.

    ``command`` maps to the wire ``cmd`` field and ``payload`` to ``body``.
    Server ack/response frames carry no ``cmd`` (``command`` is "") and are
    identified by their echoed ``req_id``; their ``errcode`` (0 == success)
    and ``errmsg`` are surfaced here.
    """

    command: str
    req_id: Optional[str] = None
    payload: Dict[str, Any] = field(default_factory=dict)
    errcode: Optional[int] = None
    errmsg: Optional[str] = None


def encode_frame(frame: WeComFrame) -> str:
    """Encode a frame to JSON text for the WebSocket.

    Always emits ``headers.req_id`` (required by the server). ``body`` is
    included only when there is payload (e.g. ``ping`` carries none).
    """
    envelope: Dict[str, Any] = {
        "cmd": frame.command,
        "headers": {"req_id": frame.req_id or ""},
    }
    if frame.payload:
        envelope["body"] = frame.payload
    return json.dumps(envelope, ensure_ascii=False)


def decode_frame(raw: str) -> WeComFrame:
    """Decode JSON text from the WebSocket into a frame."""
    data = json.loads(raw)
    headers = data.get("headers") or {}
    return WeComFrame(
        command=data.get("cmd", ""),
        req_id=headers.get("req_id"),
        payload=data.get("body") or {},
        errcode=data.get("errcode"),
        errmsg=data.get("errmsg"),
    )


def _new_req_id(prefix: str) -> str:
    """Generate a unique req_id with a type-identifying prefix.

    Server ack frames omit ``cmd`` and are matched back by the ``req_id``
    prefix, so subscribe/ping use stable prefixes.
    """
    return f"{prefix}_{uuid.uuid4().hex}"


def build_subscribe(bot_id: str, secret: str) -> WeComFrame:
    """Build the subscription/auth frame sent right after connecting."""
    return WeComFrame(
        command=CMD_SUBSCRIBE,
        req_id=_new_req_id(CMD_SUBSCRIBE),
        payload={"bot_id": bot_id, "secret": secret},
    )


def build_ping() -> WeComFrame:
    """Build a heartbeat ping frame (no body)."""
    return WeComFrame(command=CMD_PING, req_id=_new_req_id(CMD_PING))


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
    """Build a full-overwrite streaming reply frame.

    ``req_id`` MUST be the req_id echoed from the callback being answered.
    """
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
