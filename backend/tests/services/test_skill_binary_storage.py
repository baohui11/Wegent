# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for SkillBinaryStorage.

Covers the routing logic between the MySQL and S3 backends, and the
download URL / copy helpers. The S3 backend is patched out so these tests
do not require a live MinIO instance.
"""

from unittest.mock import MagicMock

import pytest

from app.services.skill_binary_storage import SkillBinaryStorage


class _FakeQuery:
    """Tiny stand-in for a SQLAlchemy query chain returning a fixed value."""

    def __init__(self, value):
        self._value = value

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._value


class _FakeSession:
    """In-memory stand-in for ``Session.query``.

    Records ``add`` and ``delete`` calls so tests can assert on row
    lifecycle without spinning up SQLAlchemy.
    """

    def __init__(self, existing=None):
        self._existing = existing
        self.added = []
        self.deleted = []
        self.flushed = False

    def query(self, _model):
        return _FakeQuery(self._existing)

    def add(self, obj):
        self.added.append(obj)

    def delete(self, obj):
        self.deleted.append(obj)

    def flush(self):
        self.flushed = True


@pytest.fixture
def storage(monkeypatch):
    """Return a SkillBinaryStorage with a stubbed S3 backend."""
    svc = SkillBinaryStorage()
    fake_backend = MagicMock()
    svc._s3_backend = fake_backend
    return svc


def _set_backend(monkeypatch, value: str) -> None:
    from app.core import config

    monkeypatch.setattr(config.settings, "ATTACHMENT_STORAGE_BACKEND", value)


class TestUsesObjectStorage:
    @pytest.mark.parametrize("backend", ["s3", "minio", "S3", "MinIO"])
    def test_returns_true_for_object_backends(self, monkeypatch, storage, backend):
        _set_backend(monkeypatch, backend)
        assert storage.uses_object_storage() is True

    @pytest.mark.parametrize("backend", ["mysql", "MYSQL", ""])
    def test_returns_false_otherwise(self, monkeypatch, storage, backend):
        _set_backend(monkeypatch, backend)
        assert storage.uses_object_storage() is False


class TestSave:
    def test_save_to_s3_creates_row_with_storage_key(self, monkeypatch, storage):
        _set_backend(monkeypatch, "s3")
        db = _FakeSession(existing=None)

        record = storage.save(
            db,
            kind_id=42,
            file_content=b"zip-bytes",
            file_size=9,
            file_hash="abc",
        )

        storage._s3_backend.save.assert_called_once()
        args, kwargs = storage._s3_backend.save.call_args
        assert args[0] == "skills/42.zip"
        assert args[1] == b"zip-bytes"
        assert kwargs["metadata"]["kind_id"] == 42
        assert record.storage_key == "skills/42.zip"
        assert record.binary_data is None
        assert record in db.added
        assert db.flushed

    def test_save_to_s3_updates_existing_row(self, monkeypatch, storage):
        _set_backend(monkeypatch, "s3")
        existing = MagicMock(
            spec=["binary_data", "storage_key", "file_size", "file_hash"]
        )
        existing.binary_data = b"old"
        existing.storage_key = None
        db = _FakeSession(existing=existing)

        record = storage.save(
            db, kind_id=7, file_content=b"new", file_size=3, file_hash="h"
        )

        assert record is existing
        assert existing.storage_key == "skills/7.zip"
        assert existing.binary_data is None
        assert db.added == []  # update path, no new row

    def test_save_to_mysql_writes_binary_data(self, monkeypatch, storage):
        _set_backend(monkeypatch, "mysql")
        db = _FakeSession(existing=None)

        record = storage.save(
            db, kind_id=11, file_content=b"data", file_size=4, file_hash="h"
        )

        storage._s3_backend.save.assert_not_called()
        assert record.binary_data == b"data"
        assert record.storage_key is None
        assert record in db.added


class TestGetBytes:
    def test_get_bytes_reads_from_s3_when_key_present(self, monkeypatch, storage):
        _set_backend(monkeypatch, "s3")
        row = MagicMock(spec=["storage_key", "binary_data"])
        row.storage_key = "skills/9.zip"
        row.binary_data = None
        db = _FakeSession(existing=row)
        storage._s3_backend.get.return_value = b"from-s3"

        assert storage.get_bytes(db, kind_id=9) == b"from-s3"
        storage._s3_backend.get.assert_called_once_with("skills/9.zip")

    def test_get_bytes_falls_back_to_mysql_when_no_key(self, monkeypatch, storage):
        _set_backend(monkeypatch, "s3")  # backend setting irrelevant for fallback
        row = MagicMock(spec=["storage_key", "binary_data"])
        row.storage_key = None
        row.binary_data = b"from-mysql"
        db = _FakeSession(existing=row)

        assert storage.get_bytes(db, kind_id=9) == b"from-mysql"
        storage._s3_backend.get.assert_not_called()

    def test_get_bytes_returns_none_when_missing(self, monkeypatch, storage):
        db = _FakeSession(existing=None)
        assert storage.get_bytes(db, kind_id=99) is None


class TestDownloadUrl:
    def test_returns_url_for_s3_row(self, monkeypatch, storage):
        row = MagicMock(spec=["storage_key"])
        row.storage_key = "skills/3.zip"
        db = _FakeSession(existing=row)
        storage._s3_backend.get_url.return_value = "https://example/abc"

        url = storage.get_download_url(db, kind_id=3, expires=120)

        assert url == "https://example/abc"
        storage._s3_backend.get_url.assert_called_once_with("skills/3.zip", expires=120)

    def test_returns_none_for_mysql_row(self, storage):
        row = MagicMock(spec=["storage_key"])
        row.storage_key = None
        db = _FakeSession(existing=row)

        assert storage.get_download_url(db, kind_id=3) is None
        storage._s3_backend.get_url.assert_not_called()


class TestDelete:
    def test_delete_removes_s3_object_and_row(self, storage):
        row = MagicMock(spec=["storage_key"])
        row.storage_key = "skills/5.zip"
        db = _FakeSession(existing=row)

        storage.delete(db, kind_id=5)

        storage._s3_backend.delete.assert_called_once_with("skills/5.zip")
        assert row in db.deleted

    def test_delete_handles_mysql_row(self, storage):
        row = MagicMock(spec=["storage_key"])
        row.storage_key = None
        db = _FakeSession(existing=row)

        storage.delete(db, kind_id=5)

        storage._s3_backend.delete.assert_not_called()
        assert row in db.deleted

    def test_delete_is_noop_when_row_missing(self, storage):
        db = _FakeSession(existing=None)
        storage.delete(db, kind_id=5)
        assert db.deleted == []
