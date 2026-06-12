# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Event-driven incremental workspace file sync.

On each subtask checkpoint (terminal event) the backend pulls a manifest of the
executor workspace, diffs it against the previous snapshot, then asks the
executor to upload only the changed files to object storage using presigned
PUT URLs. Deleted files are removed from storage directly by the backend.

The executor never holds object-storage credentials: the backend mints all
presigned URLs. This mirrors the existing workspace-archive design but operates
per file so "view task files" can serve everything from S3.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.core.config import settings
from app.services.attachment.storage_factory import is_external_storage_configured

from .storage import workspace_files_storage

logger = logging.getLogger(__name__)


class WorkspaceSyncService:
    """Coordinate incremental workspace -> object storage sync."""

    def __init__(self, request_timeout: float = 120.0) -> None:
        self._executor_manager_url = settings.EXECUTOR_MANAGER_URL.rstrip("/")
        self._request_timeout = request_timeout

    def is_enabled(self) -> bool:
        """Sync requires both the feature flag and external object storage."""
        return (
            bool(settings.WORKSPACE_SYNC_ENABLED) and is_external_storage_configured()
        )

    async def sync_task_workspace(
        self,
        task_id: int,
        executor_name: str,
        executor_namespace: str = "",
        runtime_type: Optional[str] = None,
    ) -> bool:
        """Sync a task's workspace files to object storage.

        Returns True when the sync completed (even with zero changes), False
        when skipped or failed.
        """
        if not self.is_enabled():
            logger.debug(
                "[workspace_sync] skipped task_id=%s reason=disabled_or_no_storage",
                task_id,
            )
            return False

        if runtime_type is None:
            runtime_type = await self._detect_runtime_type(task_id)

        # Sandbox runtimes (e.g. Chat Shell tasks) are located by task_id on the
        # executor_manager side, so they sync without an executor_name. Only the
        # executor runtime needs executor_name to resolve its container.
        if runtime_type != "sandbox" and not executor_name:
            logger.debug(
                "[workspace_sync] skipped task_id=%s reason=no_executor_name", task_id
            )
            return False

        try:
            manifest = await self._fetch_manifest(
                task_id=task_id,
                executor_name=executor_name,
                executor_namespace=executor_namespace,
                runtime_type=runtime_type,
            )
        except Exception as exc:
            logger.warning(
                "[workspace_sync] manifest fetch failed task_id=%s: %s", task_id, exc
            )
            return False

        current: Dict[str, str] = {
            str(entry.get("path")): str(entry.get("sha256"))
            for entry in manifest
            if entry.get("path")
        }
        sizes: Dict[str, int] = {
            str(entry.get("path")): int(entry.get("size", 0) or 0)
            for entry in manifest
            if entry.get("path")
        }

        previous = workspace_files_storage.load_manifest_snapshot(task_id)

        changed, deleted = self._diff(current, previous)
        max_bytes = settings.WORKSPACE_SYNC_MAX_FILE_SIZE_MB * 1024 * 1024

        uploads: List[Dict[str, str]] = []
        skipped_oversize: List[str] = []
        for rel_path in changed:
            if sizes.get(rel_path, 0) > max_bytes:
                skipped_oversize.append(rel_path)
                continue
            key = workspace_files_storage.build_object_key(task_id, rel_path)
            url = workspace_files_storage.generate_upload_url(key)
            if not url:
                logger.warning(
                    "[workspace_sync] presign PUT failed task_id=%s path=%s",
                    task_id,
                    rel_path,
                )
                continue
            uploads.append({"path": rel_path, "url": url})

        uploaded_paths: List[str] = []
        if uploads:
            try:
                result = await self._push_uploads(
                    task_id=task_id,
                    executor_name=executor_name,
                    executor_namespace=executor_namespace,
                    runtime_type=runtime_type,
                    uploads=uploads,
                )
                uploaded_paths = [str(p) for p in result.get("uploaded", [])]
            except Exception as exc:
                logger.warning(
                    "[workspace_sync] upload push failed task_id=%s: %s", task_id, exc
                )

        # Remove deleted files from storage.
        for rel_path in deleted:
            key = workspace_files_storage.build_object_key(task_id, rel_path)
            workspace_files_storage.delete(key)

        # Build the new snapshot from what is actually in storage: keep
        # previously-synced entries that still exist, add newly uploaded ones,
        # drop deleted ones, and preserve oversize-skipped entries' old state.
        new_snapshot: Dict[str, str] = {}
        for rel_path, sha in current.items():
            if rel_path in skipped_oversize:
                # Not uploaded; only record if it was already present before.
                if rel_path in previous:
                    new_snapshot[rel_path] = previous[rel_path]
                continue
            if rel_path in uploaded_paths or rel_path in previous:
                new_snapshot[rel_path] = sha

        try:
            workspace_files_storage.save_manifest_snapshot(task_id, new_snapshot)
        except Exception as exc:
            logger.warning(
                "[workspace_sync] snapshot save failed task_id=%s: %s", task_id, exc
            )

        logger.info(
            "[workspace_sync] done task_id=%s changed=%s uploaded=%s deleted=%s "
            "skipped_oversize=%s",
            task_id,
            len(changed),
            len(uploaded_paths),
            len(deleted),
            len(skipped_oversize),
        )
        return True

    @staticmethod
    def _diff(
        current: Dict[str, str], previous: Dict[str, str]
    ) -> Tuple[List[str], List[str]]:
        """Return (changed_or_new, deleted) relative paths."""
        changed = [path for path, sha in current.items() if previous.get(path) != sha]
        deleted = [path for path in previous if path not in current]
        return changed, deleted

    async def _detect_runtime_type(self, task_id: int) -> str:
        """Detect whether the task runs in a sandbox or executor runtime."""
        url = f"{self._executor_manager_url}/executor-manager/sandboxes/{task_id}"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
            if response.status_code == 200 and response.content:
                payload = response.json()
                if isinstance(payload, dict):
                    status = str(payload.get("status", "")).lower()
                    base_url = payload.get("base_url")
                    if status == "running" and base_url:
                        return "sandbox"
        except Exception as exc:
            logger.debug(
                "[workspace_sync] runtime detect fallback task_id=%s: %s", task_id, exc
            )
        return "executor"

    async def _fetch_manifest(
        self,
        task_id: int,
        executor_name: str,
        executor_namespace: str,
        runtime_type: str,
    ) -> List[Dict[str, Any]]:
        url = (
            f"{self._executor_manager_url}/executor-manager/executor/workspace/manifest"
        )
        payload = {
            "task_id": task_id,
            "executor_name": executor_name,
            "executor_namespace": executor_namespace,
            "runtime_type": runtime_type,
        }
        async with httpx.AsyncClient(timeout=self._request_timeout) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
        entries = data.get("entries") if isinstance(data, dict) else None
        return entries if isinstance(entries, list) else []

    async def _push_uploads(
        self,
        task_id: int,
        executor_name: str,
        executor_namespace: str,
        runtime_type: str,
        uploads: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        url = f"{self._executor_manager_url}/executor-manager/executor/workspace/sync"
        payload = {
            "task_id": task_id,
            "executor_name": executor_name,
            "executor_namespace": executor_namespace,
            "runtime_type": runtime_type,
            "uploads": uploads,
        }
        async with httpx.AsyncClient(timeout=self._request_timeout) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
        return data if isinstance(data, dict) else {}


# Global service instance
workspace_sync_service = WorkspaceSyncService()
