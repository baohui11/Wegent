# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Skill ZIP package storage service.

Encapsulates persistence of ``SkillBinary`` rows so callers (the skill_kinds
adapter, API endpoints, batch tools, ...) do not need to know whether the
bytes live in MySQL or in an S3-compatible object store.

Why a dedicated service:
    - Strategy pattern: dispatches to object storage (``S3StorageBackend``) or
      to a legacy ``binary_data`` column based on ``ATTACHMENT_STORAGE_BACKEND``.
    - Single source of truth for the storage-key format
      (``skills/{kind_id}.zip``).
    - Avoids scattering "if backend == s3 ... else ..." branches across the
      adapter and the API endpoints.

The service is stateless apart from cached settings; one process-wide
instance (``skill_binary_storage``) is exported for convenience, mirroring
the pattern used by ``archive_storage_service``.
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.skill_binary import SkillBinary
from app.services.attachment.s3_storage import S3StorageBackend
from app.services.attachment.storage_backend import StorageError

logger = logging.getLogger(__name__)


# Backend identifiers that route writes/reads to S3-compatible storage.
_OBJECT_STORAGE_BACKENDS = {"s3", "minio"}


class SkillBinaryStorage:
    """Read/write facade for Skill ZIP packages.

    The selected backend is determined at call time from
    ``settings.ATTACHMENT_STORAGE_BACKEND`` so changing the env var (and
    restarting) is enough to switch between MySQL and object storage.

    Key layout for S3:
        ``skills/{kind_id}.zip``

    A single key per Kind is used (rather than per-revision keys) because
    skills are versioned via the ``Kind.json["status"]["fileHash"]`` field
    and old object versions are never read after an upgrade.
    """

    def __init__(self) -> None:
        self._s3_backend: Optional[S3StorageBackend] = None

    # ----- public API --------------------------------------------------

    def uses_object_storage(self) -> bool:
        """Return True iff the configured backend is S3/MinIO."""
        return settings.ATTACHMENT_STORAGE_BACKEND.lower() in _OBJECT_STORAGE_BACKENDS

    def storage_key_for(self, kind_id: int) -> str:
        """Return the canonical S3 object key for a skill."""
        return f"skills/{kind_id}.zip"

    def save(
        self,
        db: Session,
        *,
        kind_id: int,
        file_content: bytes,
        file_size: int,
        file_hash: str,
        file_name: Optional[str] = None,
        binary_type: Optional[str] = None,
    ) -> SkillBinary:
        """Persist a Skill/Plugin ZIP, creating or updating the row.

        Skills and Claude Code plugins share the same ``SkillBinary`` table and
        storage path; ``binary_type`` distinguishes them (e.g. "skill" vs
        "plugin"). Returns the (attached) ``SkillBinary`` row. The DB
        transaction is flushed but not committed; callers control
        commit/rollback.
        """
        record = db.query(SkillBinary).filter(SkillBinary.kind_id == kind_id).first()

        if self.uses_object_storage():
            key = self.storage_key_for(kind_id)
            self._object_backend(db).save(
                key,
                file_content,
                metadata={
                    "kind_id": kind_id,
                    "file_size": file_size,
                    "file_hash": file_hash,
                    "content_type": "application/zip",
                },
            )
            stored_bytes: Optional[bytes] = None
            storage_key: Optional[str] = key
        else:
            stored_bytes = file_content
            storage_key = None

        if record:
            record.binary_data = stored_bytes
            record.storage_key = storage_key
            record.file_size = file_size
            record.file_hash = file_hash
        else:
            record = SkillBinary(
                kind_id=kind_id,
                binary_data=stored_bytes,
                storage_key=storage_key,
                file_size=file_size,
                file_hash=file_hash,
            )
            db.add(record)

        if file_name is not None:
            record.file_name = file_name
        if binary_type is not None:
            record.type = binary_type

        db.flush()
        return record

    def get_bytes(self, db: Session, *, kind_id: int) -> Optional[bytes]:
        """Return the ZIP bytes for a skill, or None if absent.

        Reads from S3 when the row carries a ``storage_key``; otherwise
        falls back to ``binary_data``. This dual-path read keeps the
        service backward-compatible with rows that pre-date the S3
        migration even if the backend switches at runtime.
        """
        record = db.query(SkillBinary).filter(SkillBinary.kind_id == kind_id).first()
        if record is None:
            return None

        if record.storage_key:
            try:
                return self._object_backend(db).get(record.storage_key)
            except StorageError as exc:
                logger.error(
                    "Failed to read skill binary from object storage "
                    "kind_id=%d key=%s: %s",
                    kind_id,
                    record.storage_key,
                    exc,
                )
                return None

        return record.binary_data or None

    def get_download_url(
        self,
        db: Session,
        *,
        kind_id: int,
        expires: int = 600,
        public: bool = False,
    ) -> Optional[str]:
        """Return a presigned download URL when the skill lives in S3.

        Args:
            public: Use the public endpoint rewrite for browser downloads.
                Leave False for executor / chat_shell on the Docker network.

        Returns None for rows still stored in MySQL, in which case callers
        should fall back to streaming bytes through the backend.
        """
        record = db.query(SkillBinary).filter(SkillBinary.kind_id == kind_id).first()
        if record is None or not record.storage_key:
            return None
        return self._object_backend(db).get_url(
            record.storage_key, expires=expires, public=public
        )

    def delete(self, db: Session, *, kind_id: int) -> None:
        """Delete the SkillBinary row and the underlying object (if any).

        Object deletion failures are logged but never raise; this prevents
        stale DB rows when the bucket is unreachable.
        """
        record = db.query(SkillBinary).filter(SkillBinary.kind_id == kind_id).first()
        if record is None:
            return

        if record.storage_key:
            try:
                self._object_backend(db).delete(record.storage_key)
            except Exception:
                logger.warning(
                    "Failed to delete skill object key=%s, removing DB row anyway",
                    record.storage_key,
                    exc_info=True,
                )

        db.delete(record)

    def copy(
        self, db: Session, *, source_kind_id: int, target_kind_id: int
    ) -> Optional[SkillBinary]:
        """Duplicate a Skill ZIP from source to target Kind.

        Used by ``copy_skill_to_namespace``. Re-uploads the bytes to a new
        object key so the source and target have independent lifetimes.
        Returns the new ``SkillBinary`` row, or None if the source is
        empty.
        """
        source = (
            db.query(SkillBinary).filter(SkillBinary.kind_id == source_kind_id).first()
        )
        if source is None:
            return None

        data = self.get_bytes(db, kind_id=source_kind_id)
        if data is None:
            return None

        return self.save(
            db,
            kind_id=target_kind_id,
            file_content=data,
            file_size=source.file_size,
            file_hash=source.file_hash,
        )

    # ----- helpers -----------------------------------------------------

    def _object_backend(self, db: Session) -> S3StorageBackend:
        """Return a lazily-built ``S3StorageBackend`` for the skill bucket."""
        if self._s3_backend is None:
            self._s3_backend = S3StorageBackend(
                db=db, bucket=settings.ATTACHMENT_S3_SKILL_BUCKET
            )
        return self._s3_backend


# Process-wide instance, mirroring archive_storage_service.
skill_binary_storage = SkillBinaryStorage()
