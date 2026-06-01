# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for PaddleOCR API client."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from knowledge_engine.conversion.paddleocr_client import (
    PADDLEOCR_SUPPORTED_EXTENSIONS,
    PaddleOCRConfig,
    is_paddleocr_supported_extension,
    submit_and_wait,
)


@pytest.mark.asyncio
async def test_submit_and_wait_success():
    config = PaddleOCRConfig(token="test-token")
    jsonl_text = '{"result":{"layoutParsingResults":[{"markdown":{"text":"# OCR"}}]}}'

    with patch("httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_class.return_value.__aexit__ = AsyncMock(return_value=None)

        submit_resp = MagicMock()
        submit_resp.raise_for_status = MagicMock()
        submit_resp.json.return_value = {"data": {"jobId": "job-123"}}

        status_resp = MagicMock()
        status_resp.raise_for_status = MagicMock()
        status_resp.json.return_value = {
            "data": {
                "state": "done",
                "resultUrl": {"jsonUrl": "https://example.com/result.jsonl"},
            }
        }

        download_resp = MagicMock()
        download_resp.raise_for_status = MagicMock()
        download_resp.text = jsonl_text

        mock_client.post = AsyncMock(return_value=submit_resp)
        mock_client.get = AsyncMock(side_effect=[status_resp, download_resp])

        result = await submit_and_wait(b"pdf_content", "pdf", config)
        assert result == jsonl_text


@pytest.mark.asyncio
async def test_submit_and_wait_missing_token():
    config = PaddleOCRConfig(token="")
    with pytest.raises(RuntimeError, match="token is not configured"):
        await submit_and_wait(b"pdf_content", "pdf", config)


def test_paddleocr_supported_extensions():
    assert PADDLEOCR_SUPPORTED_EXTENSIONS == frozenset(
        {"pdf", "jpeg", "jpg", "png", "tiff", "tif", "bmp"}
    )
    assert is_paddleocr_supported_extension(".PDF") is True
    assert is_paddleocr_supported_extension("webp") is False


@pytest.mark.asyncio
async def test_submit_and_wait_unsupported_extension():
    config = PaddleOCRConfig(token="test-token")
    with pytest.raises(RuntimeError, match="PaddleOCR does not support 'webp'"):
        await submit_and_wait(b"webp_content", "webp", config)


@pytest.mark.asyncio
async def test_submit_and_wait_job_failed():
    config = PaddleOCRConfig(token="test-token")

    with patch("httpx.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_class.return_value.__aexit__ = AsyncMock(return_value=None)

        submit_resp = MagicMock()
        submit_resp.raise_for_status = MagicMock()
        submit_resp.json.return_value = {"data": {"jobId": "job-fail"}}

        status_resp = MagicMock()
        status_resp.raise_for_status = MagicMock()
        status_resp.json.return_value = {
            "data": {"state": "failed", "errorMsg": "bad file"}
        }

        mock_client.post = AsyncMock(return_value=submit_resp)
        mock_client.get = AsyncMock(return_value=status_resp)

        with pytest.raises(RuntimeError, match="PaddleOCR job failed"):
            await submit_and_wait(b"pdf_content", "pdf", config)
