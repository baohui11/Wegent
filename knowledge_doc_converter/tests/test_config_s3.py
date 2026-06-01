# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for converter service S3 config resolution."""

from knowledge_doc_converter.config import ConverterSettings


def test_build_s3_config_reuses_attachment_s3(monkeypatch):
    monkeypatch.delenv("WORKER_CONVERSION_S3_ENDPOINT", raising=False)
    settings = ConverterSettings(
        CONVERSION_PROVIDER="paddleocr",
        WORKER_CONVERSION_S3_ENABLED=False,
        ATTACHMENT_S3_ENDPOINT="http://minio:9000",
        ATTACHMENT_S3_PUBLIC_ENDPOINT="http://localhost:9000",
        ATTACHMENT_S3_ACCESS_KEY="minioadmin",
        ATTACHMENT_S3_SECRET_KEY="minioadmin",
        ATTACHMENT_S3_BUCKET="attachments",
        ATTACHMENT_S3_REGION="us-east-1",
    )

    s3_config = settings.build_s3_config()

    assert s3_config.enabled is True
    assert s3_config.endpoint == "http://minio:9000"
    assert s3_config.public_endpoint == "http://localhost:9000"
    assert s3_config.bucket_name == "attachments"


def test_build_internal_auth_headers_omits_empty_token():
    settings = ConverterSettings(BACKEND_INTERNAL_TOKEN="")
    assert settings.build_internal_auth_headers() == {}


def test_build_internal_auth_headers_includes_bearer_token():
    settings = ConverterSettings(BACKEND_INTERNAL_TOKEN="secret-token")
    assert settings.build_internal_auth_headers() == {
        "Authorization": "Bearer secret-token"
    }
