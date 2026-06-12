# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for the incremental workspace -> S3 sync service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.workspace_sync.storage import WorkspaceFilesStorage
from app.services.workspace_sync.sync_service import WorkspaceSyncService


class TestWorkspaceFilesStorageKeys:
    def test_build_object_key(self):
        assert (
            WorkspaceFilesStorage.build_object_key(7, "src/main.py")
            == "workspace/7/src/main.py"
        )

    def test_build_object_key_strips_leading_slash(self):
        assert (
            WorkspaceFilesStorage.build_object_key(7, "/src/main.py")
            == "workspace/7/src/main.py"
        )

    def test_build_prefix(self):
        assert WorkspaceFilesStorage.build_prefix(7) == "workspace/7/"

    def test_relative_path_from_key(self):
        assert (
            WorkspaceFilesStorage.relative_path_from_key(7, "workspace/7/a/b.txt")
            == "a/b.txt"
        )


class TestWorkspaceSyncDiff:
    def test_detects_new_changed_and_deleted(self):
        current = {"a.txt": "h1", "b.txt": "h2new", "c.txt": "h3"}
        previous = {"b.txt": "h2old", "c.txt": "h3", "d.txt": "h4"}

        changed, deleted = WorkspaceSyncService._diff(current, previous)

        assert set(changed) == {"a.txt", "b.txt"}
        assert deleted == ["d.txt"]

    def test_no_changes(self):
        snapshot = {"a.txt": "h1"}
        changed, deleted = WorkspaceSyncService._diff(snapshot, snapshot)
        assert changed == []
        assert deleted == []


class TestWorkspaceSyncServiceFlow:
    @pytest.mark.asyncio
    async def test_skips_when_disabled(self):
        service = WorkspaceSyncService()
        with patch.object(service, "is_enabled", return_value=False):
            result = await service.sync_task_workspace(
                task_id=1, executor_name="exec-1"
            )
        assert result is False

    @pytest.mark.asyncio
    async def test_skips_when_executor_runtime_has_no_executor(self):
        service = WorkspaceSyncService()
        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(
                service, "_detect_runtime_type", AsyncMock(return_value="executor")
            ),
        ):
            result = await service.sync_task_workspace(task_id=1, executor_name="")
        assert result is False

    @pytest.mark.asyncio
    async def test_syncs_sandbox_without_executor_name(self):
        """Chat Shell tasks run in a sandbox resolved by task_id, no executor_name."""
        service = WorkspaceSyncService()
        manifest = [{"path": "out.pdf", "size": 10, "sha256": "h1"}]

        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(
                service, "_detect_runtime_type", AsyncMock(return_value="sandbox")
            ),
            patch.object(service, "_fetch_manifest", AsyncMock(return_value=manifest)),
            patch.object(
                service,
                "_push_uploads",
                AsyncMock(return_value={"uploaded": ["out.pdf"], "failed": []}),
            ) as push_mock,
            patch(
                "app.services.workspace_sync.sync_service.workspace_files_storage"
            ) as storage,
        ):
            storage.load_manifest_snapshot.return_value = {}
            storage.build_object_key.side_effect = lambda tid, p: f"workspace/{tid}/{p}"
            storage.generate_upload_url.return_value = "http://put"

            result = await service.sync_task_workspace(task_id=23, executor_name="")

        assert result is True
        push_mock.assert_awaited_once()
        # The push must carry the sandbox runtime so the manager resolves by task_id.
        assert push_mock.await_args.kwargs["runtime_type"] == "sandbox"

    @pytest.mark.asyncio
    async def test_uploads_changed_and_deletes_removed(self):
        service = WorkspaceSyncService()

        manifest = [
            {"path": "a.txt", "size": 10, "sha256": "h1"},
            {"path": "b.txt", "size": 10, "sha256": "h2"},
        ]

        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(
                service, "_detect_runtime_type", AsyncMock(return_value="executor")
            ),
            patch.object(service, "_fetch_manifest", AsyncMock(return_value=manifest)),
            patch.object(
                service,
                "_push_uploads",
                AsyncMock(return_value={"uploaded": ["a.txt", "b.txt"], "failed": []}),
            ),
            patch(
                "app.services.workspace_sync.sync_service.workspace_files_storage"
            ) as storage,
        ):
            storage.load_manifest_snapshot.return_value = {"old.txt": "hx"}
            storage.build_object_key.side_effect = lambda tid, p: f"workspace/{tid}/{p}"
            storage.generate_upload_url.return_value = "http://put"

            result = await service.sync_task_workspace(
                task_id=5, executor_name="exec-1"
            )

        assert result is True
        # old.txt was in previous snapshot but not current -> deleted from S3
        storage.delete.assert_called_once_with("workspace/5/old.txt")
        # snapshot persisted with the two current files
        saved = storage.save_manifest_snapshot.call_args[0][1]
        assert set(saved.keys()) == {"a.txt", "b.txt"}

    @pytest.mark.asyncio
    async def test_skips_oversize_files(self):
        service = WorkspaceSyncService()
        # 200 MB file, default limit is 100 MB
        manifest = [{"path": "big.bin", "size": 200 * 1024 * 1024, "sha256": "h1"}]

        push_mock = AsyncMock(return_value={"uploaded": [], "failed": []})
        with (
            patch.object(service, "is_enabled", return_value=True),
            patch.object(
                service, "_detect_runtime_type", AsyncMock(return_value="executor")
            ),
            patch.object(service, "_fetch_manifest", AsyncMock(return_value=manifest)),
            patch.object(service, "_push_uploads", push_mock),
            patch(
                "app.services.workspace_sync.sync_service.workspace_files_storage"
            ) as storage,
        ):
            storage.load_manifest_snapshot.return_value = {}
            storage.build_object_key.side_effect = lambda tid, p: f"workspace/{tid}/{p}"
            storage.generate_upload_url.return_value = "http://put"

            result = await service.sync_task_workspace(
                task_id=9, executor_name="exec-1"
            )

        assert result is True
        # Oversize file must not be pushed for upload.
        push_mock.assert_not_called()
