# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Temporary workaround for langchain-anthropic streaming bugs.

Anthropic streaming `message_delta` events may return `context_management` and
`container` as plain dicts, while langchain-anthropic 1.4.x calls
`.model_dump()` unconditionally. Remove this module once upstream fixes it.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_PATCH_APPLIED = False
_ORIGINAL_MAKE_MESSAGE_CHUNK = None


def _to_dict(obj: Any, *, json_mode: bool = False) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj
    model_dump = getattr(obj, "model_dump", None)
    if callable(model_dump):
        if json_mode:
            return model_dump(mode="json")
        return model_dump()
    return obj


def _make_message_chunk_from_anthropic_event_patched(
    self,
    event: Any,
    *,
    stream_usage: bool = True,
    coerce_content_to_string: bool,
    block_start_event: Any | None = None,
):
    if event.type == "message_delta" and stream_usage:
        from langchain_anthropic.chat_models import _create_usage_metadata
        from langchain_core.messages import AIMessageChunk

        usage_metadata = _create_usage_metadata(event.usage)
        response_metadata = {
            "stop_reason": event.delta.stop_reason,
            "stop_sequence": event.delta.stop_sequence,
        }
        if context_management := getattr(event, "context_management", None):
            response_metadata["context_management"] = _to_dict(context_management)
        message_delta = getattr(event, "delta", None)
        if message_delta and (container := getattr(message_delta, "container", None)):
            response_metadata["container"] = _to_dict(container, json_mode=True)
        message_chunk = AIMessageChunk(
            content="" if coerce_content_to_string else [],
            usage_metadata=usage_metadata,
            response_metadata=response_metadata,
        )
        if message_chunk.response_metadata.get("stop_reason"):
            message_chunk.chunk_position = "last"
        message_chunk.response_metadata["model_provider"] = "anthropic"
        return message_chunk, block_start_event

    return _ORIGINAL_MAKE_MESSAGE_CHUNK(
        self,
        event,
        stream_usage=stream_usage,
        coerce_content_to_string=coerce_content_to_string,
        block_start_event=block_start_event,
    )


def apply_langchain_anthropic_stream_patch() -> None:
    """Patch ChatAnthropic streaming to accept dict context metadata."""
    global _PATCH_APPLIED, _ORIGINAL_MAKE_MESSAGE_CHUNK

    if _PATCH_APPLIED:
        return

    from langchain_anthropic.chat_models import ChatAnthropic

    _ORIGINAL_MAKE_MESSAGE_CHUNK = (
        ChatAnthropic._make_message_chunk_from_anthropic_event
    )
    ChatAnthropic._make_message_chunk_from_anthropic_event = (  # type: ignore[method-assign]
        _make_message_chunk_from_anthropic_event_patched
    )
    _PATCH_APPLIED = True
    logger.debug("Applied langchain-anthropic streaming compatibility patch")
