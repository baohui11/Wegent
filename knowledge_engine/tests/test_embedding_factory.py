# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from knowledge_engine.embedding.custom import CustomEmbedding
from knowledge_engine.embedding.factory import (
    create_embedding_model_from_runtime_config,
)
from shared.models import RuntimeEmbeddingModelConfig


def test_create_embedding_model_uses_runtime_model_name_when_model_id_missing(
    mocker,
) -> None:
    custom_embedding_cls = mocker.patch(
        "knowledge_engine.embedding.factory.CustomEmbedding",
        return_value=SimpleNamespace(),
    )

    create_embedding_model_from_runtime_config(
        RuntimeEmbeddingModelConfig(
            model_name="custom-embedding-model",
            resolved_config={
                "protocol": "openai",
                "base_url": "https://api.openai.com/v1",
                "custom_headers": {"X-Test": "1"},
            },
        )
    )

    custom_embedding_cls.assert_called_once_with(
        api_url="https://api.openai.com/v1/embeddings",
        model="custom-embedding-model",
        headers={"X-Test": "1"},
        api_key=None,
        dimensions=None,
    )


def test_create_embedding_model_uses_custom_embedding_for_openai_compatible_endpoint(
    mocker,
) -> None:
    custom_embedding_cls = mocker.patch(
        "knowledge_engine.embedding.factory.CustomEmbedding",
        return_value=SimpleNamespace(),
    )
    openai_embedding_cls = mocker.patch(
        "llama_index.embeddings.openai.OpenAIEmbedding",
        return_value=SimpleNamespace(),
    )

    create_embedding_model_from_runtime_config(
        RuntimeEmbeddingModelConfig(
            model_name="text-embedding-v4",
            resolved_config={
                "protocol": "openai",
                "api_key": "test-key",
                "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "model_id": "text-embedding-v4",
                "dimensions": 1024,
            },
        )
    )

    custom_embedding_cls.assert_called_once_with(
        api_url="https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
        model="text-embedding-v4",
        headers={},
        api_key="test-key",
        dimensions=1024,
    )
    openai_embedding_cls.assert_not_called()


def test_create_embedding_model_exposes_additional_input_modalities(mocker) -> None:
    embedding_instance = SimpleNamespace()
    custom_embedding_cls = mocker.patch(
        "knowledge_engine.embedding.factory.CustomEmbedding",
        return_value=embedding_instance,
    )

    result = create_embedding_model_from_runtime_config(
        RuntimeEmbeddingModelConfig(
            model_name="custom-embedding-model",
            resolved_config={
                "protocol": "custom",
                "base_url": "https://example.com/embeddings",
                "additional_input_modalities": ["image"],
            },
        )
    )

    custom_embedding_cls.assert_called_once()
    assert result is embedding_instance
    assert result._additional_input_modalities == ["image"]


@pytest.mark.asyncio
async def test_custom_embedding_supports_async_text_embedding(mocker) -> None:
    embedding = CustomEmbedding(
        api_url="https://api.openai.com/v1/embeddings",
        model="text-embedding-3-small",
    )
    mocker.patch.object(embedding, "_call_api", return_value=[0.1, 0.2, 0.3])

    result = await embedding._aget_text_embedding("release plan")

    assert result == [0.1, 0.2, 0.3]
