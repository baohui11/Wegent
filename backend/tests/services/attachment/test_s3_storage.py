# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the S3StorageBackend.

These tests mock the underlying MinIO client so they can run in CI without a
real object store. They cover the six abstract methods, presigned URL
generation, the public-endpoint rewrite, and graceful handling of
``S3Error`` failures.
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from minio.error import S3Error

from app.services.attachment.s3_storage import S3StorageBackend
from app.services.attachment.storage_backend import StorageError


def _make_s3_error(code: str = "NoSuchKey") -> S3Error:
    """Construct a MinIO S3Error for tests with the given code."""
    return S3Error(
        code=code,
        message=code,
        resource="bucket/object",
        request_id="rid",
        host_id="hid",
        response=None,
    )


class _FakeResponse:
    """Minimal stand-in for the ``urllib3`` response returned by ``get_object``."""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.closed = False
        self.released = False

    def stream(self, _chunk_size):
        for chunk in self._chunks:
            yield chunk

    def close(self):
        self.closed = True

    def release_conn(self):
        self.released = True


@pytest.fixture(autouse=True)
def _patch_settings(monkeypatch):
    """Provide minimal settings so the backend can build a client."""
    from app.core import config

    monkeypatch.setattr(config.settings, "ATTACHMENT_S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setattr(config.settings, "ATTACHMENT_S3_ACCESS_KEY", "minioadmin")
    monkeypatch.setattr(config.settings, "ATTACHMENT_S3_SECRET_KEY", "minioadmin")
    monkeypatch.setattr(config.settings, "ATTACHMENT_S3_BUCKET", "attachments")
    monkeypatch.setattr(config.settings, "ATTACHMENT_S3_REGION", "us-east-1")
    monkeypatch.setattr(config.settings, "ATTACHMENT_S3_USE_SSL", False)
    monkeypatch.setattr(config.settings, "ATTACHMENT_S3_PUBLIC_ENDPOINT", "")


@pytest.fixture
def backend():
    """Return an S3StorageBackend wired to a MagicMock client."""
    storage = S3StorageBackend(db=MagicMock())
    mock_client = MagicMock()
    mock_client.bucket_exists.return_value = True
    storage._client = mock_client
    return storage


class TestS3StorageBackendSave:
    def test_save_uploads_with_metadata(self, backend):
        key = "attachments/abc_20260520_1_42"
        data = b"hello world"
        metadata = {"filename": "a.pdf", "mime_type": "application/pdf", "user_id": 7}

        result = backend.save(key, data, metadata)

        assert result == key
        backend._client.put_object.assert_called_once()
        args, kwargs = backend._client.put_object.call_args
        assert args[0] == "attachments"
        assert args[1] == key
        assert args[3] == len(data)
        assert kwargs["content_type"] == "application/pdf"
        # MinIO requires string-valued metadata, so integers must be coerced.
        assert kwargs["metadata"]["user_id"] == "7"

    def test_save_wraps_s3_error_in_storage_error(self, backend):
        backend._client.put_object.side_effect = _make_s3_error("AccessDenied")

        with pytest.raises(StorageError) as exc_info:
            backend.save("attachments/k", b"x", {})

        assert "AccessDenied" in str(exc_info.value)
        assert exc_info.value.key == "attachments/k"


class TestS3StorageBackendGet:
    def test_get_streams_object_body(self, backend):
        backend._client.get_object.return_value = _FakeResponse([b"foo", b"bar"])

        result = backend.get("attachments/k")

        assert result == b"foobar"
        backend._client.get_object.assert_called_once_with(
            "attachments", "attachments/k"
        )

    def test_get_returns_none_when_missing(self, backend):
        backend._client.get_object.side_effect = _make_s3_error("NoSuchKey")

        assert backend.get("attachments/missing") is None

    def test_get_returns_none_on_unexpected_error(self, backend):
        backend._client.get_object.side_effect = RuntimeError("boom")

        assert backend.get("attachments/k") is None


class TestS3StorageBackendDelete:
    def test_delete_returns_true_on_success(self, backend):
        assert backend.delete("attachments/k") is True
        backend._client.remove_object.assert_called_once_with(
            "attachments", "attachments/k"
        )

    def test_delete_returns_false_on_s3_error(self, backend):
        backend._client.remove_object.side_effect = _make_s3_error("AccessDenied")

        assert backend.delete("attachments/k") is False


class TestS3StorageBackendExists:
    def test_exists_returns_true(self, backend):
        backend._client.stat_object.return_value = MagicMock()
        assert backend.exists("attachments/k") is True

    def test_exists_returns_false_for_missing_object(self, backend):
        backend._client.stat_object.side_effect = _make_s3_error("NoSuchKey")
        assert backend.exists("attachments/k") is False

    def test_exists_returns_false_on_other_error(self, backend):
        backend._client.stat_object.side_effect = _make_s3_error("AccessDenied")
        assert backend.exists("attachments/k") is False


class TestS3StorageBackendUrls:
    def test_get_url_returns_presigned_url(self, backend):
        backend._client.presigned_get_object.return_value = (
            "http://minio:9000/attachments/k?X-Amz-Signature=abc"
        )

        url = backend.get_url("attachments/k", expires=600)

        assert "X-Amz-Signature=abc" in url
        backend._client.presigned_get_object.assert_called_once_with(
            "attachments", "attachments/k", expires=timedelta(seconds=600)
        )

    def test_get_url_returns_none_on_error(self, backend):
        backend._client.presigned_get_object.side_effect = _make_s3_error(
            "InvalidRequest"
        )
        assert backend.get_url("attachments/k") is None

    def test_get_upload_url_returns_presigned_url(self, backend):
        backend._client.presigned_put_object.return_value = (
            "http://minio:9000/attachments/k?X-Amz-Signature=put"
        )

        url = backend.get_upload_url("attachments/k", expires=120)

        assert "X-Amz-Signature=put" in url
        backend._client.presigned_put_object.assert_called_once_with(
            "attachments", "attachments/k", expires=timedelta(seconds=120)
        )

    def test_get_url_keeps_internal_endpoint_by_default(self, backend, monkeypatch):
        from app.core import config

        monkeypatch.setattr(
            config.settings, "ATTACHMENT_S3_PUBLIC_ENDPOINT", "http://localhost:9000"
        )
        backend._client.presigned_get_object.return_value = (
            "http://minio:9000/attachments/k?X-Amz-Signature=abc"
        )

        url = backend.get_url("attachments/k")

        assert url.startswith("http://minio:9000/")
        assert "X-Amz-Signature=abc" in url

    def test_get_url_rewrites_public_endpoint_when_requested(
        self, backend, monkeypatch
    ):
        from app.core import config

        monkeypatch.setattr(
            config.settings, "ATTACHMENT_S3_PUBLIC_ENDPOINT", "http://localhost:9000"
        )
        backend._client.presigned_get_object.return_value = (
            "http://minio:9000/attachments/k?X-Amz-Signature=abc"
        )

        url = backend.get_url("attachments/k", public=True)

        assert url.startswith("http://localhost:9000/")
        assert "X-Amz-Signature=abc" in url


class TestS3StorageBackendBootstrap:
    def test_backend_type(self, backend):
        assert backend.backend_type == "s3"

    def test_build_client_raises_when_not_configured(self, monkeypatch):
        from app.core import config

        monkeypatch.setattr(config.settings, "ATTACHMENT_S3_ENDPOINT", "")
        storage = S3StorageBackend(db=MagicMock())

        with pytest.raises(StorageError):
            _ = storage.client

    def test_client_creates_bucket_when_missing(self, monkeypatch):
        storage = S3StorageBackend(db=MagicMock())

        fake_minio = MagicMock()
        fake_minio.bucket_exists.return_value = False
        with patch(
            "app.services.attachment.s3_storage.Minio",
            return_value=fake_minio,
        ):
            _ = storage.client

        fake_minio.make_bucket.assert_called_once_with("attachments")
