# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for langchain-anthropic streaming compatibility patch."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import langchain_anthropic.chat_models as chat_models_module
import pytest
from langchain_anthropic.chat_models import ChatAnthropic

from chat_shell.compat import langchain_anthropic_patch as patch_module


@pytest.fixture(autouse=True)
def reset_langchain_anthropic_patch():
    original = patch_module._ORIGINAL_MAKE_MESSAGE_CHUNK
    patch_module._PATCH_APPLIED = False
    patch_module._ORIGINAL_MAKE_MESSAGE_CHUNK = None
    if original is not None:
        ChatAnthropic._make_message_chunk_from_anthropic_event = original
    yield
    original = patch_module._ORIGINAL_MAKE_MESSAGE_CHUNK
    patch_module._PATCH_APPLIED = False
    patch_module._ORIGINAL_MAKE_MESSAGE_CHUNK = None
    if original is not None:
        ChatAnthropic._make_message_chunk_from_anthropic_event = original


def _build_message_delta_event(
    *,
    context_management=None,
    container=None,
):
    return SimpleNamespace(
        type="message_delta",
        usage=SimpleNamespace(
            input_tokens=100,
            output_tokens=20,
            cache_read_input_tokens=None,
            cache_creation_input_tokens=None,
        ),
        delta=SimpleNamespace(
            stop_reason="end_turn",
            stop_sequence=None,
            container=container,
        ),
        context_management=context_management,
    )


def test_unpatched_message_delta_dict_context_management_raises():
    model = ChatAnthropic(model="claude-opus-4-8", anthropic_api_key="test-key")
    event = _build_message_delta_event(context_management={"applied_edits": []})

    with pytest.raises(AttributeError, match="model_dump"):
        model._make_message_chunk_from_anthropic_event(
            event,
            stream_usage=True,
            coerce_content_to_string=True,
        )


def test_patched_message_delta_dict_context_management():
    patch_module.apply_langchain_anthropic_stream_patch()
    model = ChatAnthropic(model="claude-opus-4-8", anthropic_api_key="test-key")
    event = _build_message_delta_event(context_management={"applied_edits": []})

    message_chunk, block_start_event = model._make_message_chunk_from_anthropic_event(
        event,
        stream_usage=True,
        coerce_content_to_string=True,
    )

    assert block_start_event is None
    assert message_chunk is not None
    assert message_chunk.response_metadata["context_management"] == {
        "applied_edits": []
    }
    assert message_chunk.response_metadata["model_provider"] == "anthropic"
    assert message_chunk.chunk_position == "last"


def test_patched_message_delta_dict_container():
    patch_module.apply_langchain_anthropic_stream_patch()
    model = ChatAnthropic(model="claude-opus-4-8", anthropic_api_key="test-key")
    event = _build_message_delta_event(
        context_management={"applied_edits": []},
        container={"id": "container-1"},
    )

    message_chunk, _ = model._make_message_chunk_from_anthropic_event(
        event,
        stream_usage=True,
        coerce_content_to_string=True,
    )

    assert message_chunk is not None
    assert message_chunk.response_metadata["container"] == {"id": "container-1"}


def test_patched_message_delta_pydantic_objects_still_work():
    patch_module.apply_langchain_anthropic_stream_patch()
    model = ChatAnthropic(model="claude-opus-4-8", anthropic_api_key="test-key")

    context_management = MagicMock()
    context_management.model_dump.return_value = {"applied_edits": ["trim"]}
    container = MagicMock()
    container.model_dump.return_value = {"id": "container-2"}
    event = _build_message_delta_event(
        context_management=context_management,
        container=container,
    )

    message_chunk, _ = model._make_message_chunk_from_anthropic_event(
        event,
        stream_usage=True,
        coerce_content_to_string=True,
    )

    assert message_chunk is not None
    assert message_chunk.response_metadata["context_management"] == {
        "applied_edits": ["trim"]
    }
    assert message_chunk.response_metadata["container"] == {"id": "container-2"}
    context_management.model_dump.assert_called_once_with()
    container.model_dump.assert_called_once_with(mode="json")


def test_apply_patch_is_idempotent():
    patch_module.apply_langchain_anthropic_stream_patch()
    first = ChatAnthropic._make_message_chunk_from_anthropic_event

    patch_module.apply_langchain_anthropic_stream_patch()

    assert ChatAnthropic._make_message_chunk_from_anthropic_event is first


def test_create_app_applies_patch():
    from chat_shell.main import create_app

    create_app(storage_type="memory")

    assert patch_module._PATCH_APPLIED is True
    assert ChatAnthropic._make_message_chunk_from_anthropic_event is (
        chat_models_module.ChatAnthropic._make_message_chunk_from_anthropic_event
    )
