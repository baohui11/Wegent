# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for unified converter entry point."""

import io
import zipfile
from unittest.mock import patch

import pytest

from knowledge_engine.conversion.converter import ConversionResult, convert_document
from knowledge_engine.conversion.mineru_client import MinerUConfig
from knowledge_engine.conversion.paddleocr_client import PaddleOCRConfig
from knowledge_engine.conversion.s3_uploader import S3Config


def _make_zip_with_md(md_content: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("document.md", md_content)
    return buf.getvalue()


def test_convert_document_unsupported_extension():
    config = MinerUConfig(api_base_url="http://mineru:8367")
    with pytest.raises(RuntimeError, match="not supported"):
        convert_document(b"data", "txt", provider="mineru", mineru_config=config)


def test_convert_document_unsupported_extension_jpg():
    config = MinerUConfig(api_base_url="http://mineru:8367")
    with pytest.raises(RuntimeError, match="not supported"):
        convert_document(b"data", ".jpg", provider="mineru", mineru_config=config)


def test_convert_document_success_pdf():
    config = MinerUConfig(api_base_url="http://mineru:8367")
    zip_bytes = _make_zip_with_md("# Converted PDF")

    async def _fake_submit(*_args, **_kwargs):
        return zip_bytes

    with patch(
        "knowledge_engine.conversion.converter.mineru_submit_and_wait",
        side_effect=_fake_submit,
    ):
        result = convert_document(
            b"pdf_bytes", "pdf", provider="mineru", mineru_config=config
        )

    assert isinstance(result, ConversionResult)
    assert result.markdown_bytes == b"# Converted PDF"
    assert result.uploaded_images == []


def test_convert_document_success_with_dot_extension():
    config = MinerUConfig(api_base_url="http://mineru:8367")
    zip_bytes = _make_zip_with_md("# Converted DOCX")

    async def _fake_submit(*_args, **_kwargs):
        return zip_bytes

    with patch(
        "knowledge_engine.conversion.converter.mineru_submit_and_wait",
        side_effect=_fake_submit,
    ):
        result = convert_document(
            b"docx_bytes", ".docx", provider="mineru", mineru_config=config
        )

    assert result.markdown_bytes == b"# Converted DOCX"


def test_convert_document_result_is_frozen():
    """ConversionResult is a frozen dataclass."""
    config = MinerUConfig(api_base_url="http://mineru:8367")
    zip_bytes = _make_zip_with_md("# Test")

    async def _fake_submit(*_args, **_kwargs):
        return zip_bytes

    with patch(
        "knowledge_engine.conversion.converter.mineru_submit_and_wait",
        side_effect=_fake_submit,
    ):
        result = convert_document(
            b"data", "pptx", provider="mineru", mineru_config=config
        )

    with pytest.raises((AttributeError, TypeError)):
        result.markdown_bytes = b"tamper"  # type: ignore[misc]


def test_convert_document_paddleocr_requires_s3():
    paddle_config = PaddleOCRConfig(token="test-token")
    with pytest.raises(RuntimeError, match="requires enabled S3"):
        convert_document(
            b"pdf_bytes",
            "pdf",
            provider="paddleocr",
            paddleocr_config=paddle_config,
            s3_config=S3Config(enabled=False),
            s3_base_path="kb/doc",
        )


def test_convert_document_paddleocr_rejects_pptx():
    paddle_config = PaddleOCRConfig(token="test-token")
    s3_config = S3Config(
        enabled=True,
        endpoint="http://minio:9000",
        access_key="key",
        secret_key="secret",
        bucket_name="attachments",
    )
    with pytest.raises(RuntimeError, match="PaddleOCR does not support 'pptx'"):
        convert_document(
            b"pptx_bytes",
            "pptx",
            provider="paddleocr",
            paddleocr_config=paddle_config,
            s3_config=s3_config,
            s3_base_path="kb/doc",
        )


def test_convert_document_paddleocr_rejects_webp():
    paddle_config = PaddleOCRConfig(token="test-token")
    s3_config = S3Config(
        enabled=True,
        endpoint="http://minio:9000",
        access_key="key",
        secret_key="secret",
        bucket_name="attachments",
    )
    with pytest.raises(RuntimeError, match="PaddleOCR does not support 'webp'"):
        convert_document(
            b"webp_bytes",
            "webp",
            provider="paddleocr",
            paddleocr_config=paddle_config,
            s3_config=s3_config,
            s3_base_path="kb/doc",
        )


def test_convert_document_paddleocr_success():
    paddle_config = PaddleOCRConfig(token="test-token")
    s3_config = S3Config(
        enabled=True,
        endpoint="http://minio:9000",
        access_key="key",
        secret_key="secret",
        bucket_name="attachments",
    )
    jsonl_text = (
        '{"result":{"layoutParsingResults":[{"markdown":{"text":"# Page 1","images":{}}}]}}'
    )

    async def _fake_submit(*_args, **_kwargs):
        return jsonl_text

    with patch(
        "knowledge_engine.conversion.converter.paddleocr_submit_and_wait",
        side_effect=_fake_submit,
    ):
        result = convert_document(
            b"pdf_bytes",
            "pdf",
            provider="paddleocr",
            paddleocr_config=paddle_config,
            s3_config=s3_config,
            s3_base_path="kb/doc",
        )

    assert result.markdown_bytes == b"# Page 1"
