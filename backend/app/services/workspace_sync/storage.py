# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Object storage helper for synced workspace files.

Workspace files produced by executors are mirrored to object storage under
``workspace/{task_id}/{relative_path}`` so that the "view task files" UI can
list and download them through the same presigned-URL path as attachments
(which transparently flows through the encrypt/decrypt gateway).

This wraps the shared :class:`S3StorageBackend` so we reuse one MinIO client
implementation (including ``ATTACHMENT_S3_PUBLIC_ENDPOINT`` presign handling)
instead of duplicating connection logic.
"""

from __future__ import annotations

import json
import logging
import posixpath
from typing import Dict, List, Optional

from app.core.config import settings
from app.services.attachment.s3_storage import S3StorageBackend

logger = logging.getLogger(__name__)

# Object key prefix for synced files and the per-task sync snapshot.
_FILES_PREFIX = "workspace"
_MANIFEST_PREFIX = "workspace-manifests"


class WorkspaceFilesStorage:
    """Presigned-URL oriented storage for synced workspace files."""

    def __init__(self) -> None:
        self._backend: Optional[S3StorageBackend] = None

    @property
    def backend(self) -> S3StorageBackend:
        """Lazily build the S3 backend bound to the workspace-files bucket."""
        if self._backend is None:
            # db is unused by S3StorageBackend; pass None to avoid a session.
            self._backend = S3StorageBackend(
                db=None, bucket=settings.WORKSPACE_FILES_BUCKET
            )
        return self._backend

    @staticmethod
    def build_object_key(task_id: int, relative_path: str) -> str:
        """Build the object key for a workspace file."""
        clean = relative_path.lstrip("/")
        return f"{_FILES_PREFIX}/{task_id}/{clean}"

    @staticmethod
    def build_prefix(task_id: int) -> str:
        """Build the object key prefix for a task's workspace files."""
        return f"{_FILES_PREFIX}/{task_id}/"

    @staticmethod
    def relative_path_from_key(task_id: int, key: str) -> str:
        """Recover the relative path from an object key."""
        prefix = WorkspaceFilesStorage.build_prefix(task_id)
        if key.startswith(prefix):
            return key[len(prefix) :]
        return key

    @staticmethod
    def _manifest_key(task_id: int) -> str:
        return f"{_MANIFEST_PREFIX}/{task_id}.json"

    def generate_upload_url(self, key: str) -> Optional[str]:
        """Generate a presigned PUT URL for the executor to upload bytes.

        The PUT is performed server-side by the executor container (envd), which
        lives on the in-cluster Docker network and cannot reach the
        browser-facing public endpoint. Sign with the internal endpoint so the
        upload connection succeeds.
        """
        return self.backend.get_upload_url(
            key,
            expires=settings.WORKSPACE_SYNC_PRESIGN_EXPIRE_SECONDS,
            public=False,
        )

    def generate_download_url(self, key: str) -> Optional[str]:
        """Generate a presigned GET URL (signed for the public gateway)."""
        return self.backend.get_url(
            key,
            expires=settings.WORKSPACE_SYNC_PRESIGN_EXPIRE_SECONDS,
            public=True,
        )

    def exists(self, key: str) -> bool:
        return self.backend.exists(key)

    def delete(self, key: str) -> bool:
        return self.backend.delete(key)

    def list_files(self, task_id: int) -> List[dict]:
        """List synced files for a task.

        Returns ``{"path", "size", "last_modified"}`` entries with POSIX
        relative paths.
        """
        prefix = self.build_prefix(task_id)
        objects = self.backend.list_objects(prefix)
        files: List[dict] = []
        for obj in objects:
            files.append(
                {
                    "path": self.relative_path_from_key(task_id, obj["key"]),
                    "size": obj.get("size", 0),
                    "last_modified": obj.get("last_modified"),
                }
            )
        return files

    def load_manifest_snapshot(self, task_id: int) -> Dict[str, str]:
        """Load the previous sync snapshot (relative_path -> sha256)."""
        key = self._manifest_key(task_id)
        raw = self.backend.get(key)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
        except (ValueError, UnicodeDecodeError) as exc:
            logger.warning(
                "[workspace_sync] invalid manifest snapshot task_id=%s: %s",
                task_id,
                exc,
            )
        return {}

    def save_manifest_snapshot(self, task_id: int, snapshot: Dict[str, str]) -> None:
        """Persist the sync snapshot (relative_path -> sha256) to storage."""
        key = self._manifest_key(task_id)
        payload = json.dumps(snapshot, ensure_ascii=False).encode("utf-8")
        self.backend.save(key, payload, {"mime_type": "application/json"})


# Global instance
workspace_files_storage = WorkspaceFilesStorage()
