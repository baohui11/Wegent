# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for PaddleOCR JSONL extractor."""

import json
from unittest.mock import patch

import pytest

from knowledge_engine.conversion.jsonl_extractor import extract_markdown_from_jsonl
from knowledge_engine.conversion.s3_uploader import S3Config, S3Uploader


def _build_jsonl(*pages: str) -> str:
    lines = []
    for page in pages:
        lines.append(
            json.dumps(
                {
                    "result": {
                        "layoutParsingResults": [
                            {"markdown": {"text": page, "images": {}}}
                        ]
                    }
                }
            )
        )
    return "\n".join(lines)


def test_extract_markdown_from_jsonl_requires_s3():
    uploader = S3Uploader(S3Config(enabled=False))
    with pytest.raises(RuntimeError, match="requires WORKER_CONVERSION_S3_ENABLED"):
        extract_markdown_from_jsonl(_build_jsonl("# Page"), uploader, "kb/doc")


def test_extract_markdown_from_jsonl_combines_pages():
    uploader = S3Uploader(
        S3Config(
            enabled=True,
            endpoint="http://minio:9000",
            access_key="key",
            secret_key="secret",
            bucket_name="attachments",
        )
    )
    jsonl_text = _build_jsonl("# Page 1", "# Page 2")

    result = extract_markdown_from_jsonl(jsonl_text, uploader, "kb/doc")

    assert result.markdown_bytes.decode("utf-8") == "# Page 1\n\n---\n\n# Page 2"
    assert result.uploaded_images == []


def test_extract_markdown_from_jsonl_localizes_images():
    uploader = S3Uploader(
        S3Config(
            enabled=True,
            endpoint="http://minio:9000",
            access_key="key",
            secret_key="secret",
            bucket_name="attachments",
        )
    )
    jsonl_text = json.dumps(
        {
            "result": {
                "layoutParsingResults": [
                    {
                        "markdown": {
                            "text": "![chart](images/chart.png)",
                            "images": {
                                "images/chart.png": "https://example.com/chart.png"
                            },
                        }
                    }
                ]
            }
        }
    )

    with patch(
        "knowledge_engine.conversion.jsonl_extractor._download_image",
        return_value=b"image-bytes",
    ), patch.object(
        S3Uploader,
        "upload_image",
        return_value="http://minio:9000/attachments/kb/doc/page_1/images/chart.png",
    ) as mock_upload:
        result = extract_markdown_from_jsonl(jsonl_text, uploader, "kb/doc")

    mock_upload.assert_called_once()
    assert (
        result.markdown_bytes.decode("utf-8")
        == "![chart](http://minio:9000/attachments/kb/doc/page_1/images/chart.png)"
    )
    assert len(result.uploaded_images) == 1
