---
sidebar_position: 29
---

# Workspace File Sync to Object Storage

Workspace File Sync mirrors the files an Executor produces in its workspace to S3 object storage, incrementally, on every subtask checkpoint. The "view task files" UI then lists and downloads files from object storage through the encrypt/decrypt gateway, exactly like attachments.

This resolves a long-standing inconsistency: attachments used S3, while workspace files could only be read live via the Backend → Executor Manager → envd proxy, so their download path never went through the gateway and the storage/access path was fragmented.

## Use Cases

- Workspace files produced by code tasks and chat tasks in the Executor / Sandbox runtime.
- Users browsing, previewing, and downloading workspace files via "view task files".

Syncing is **incremental**: on each subtask terminal state only changed files are uploaded and removed files are deleted. When `WORKSPACE_SYNC_ENABLED` is off or object storage is not configured, the system transparently falls back to the original envd live proxy path, so behavior is fully backward compatible.

## Architecture

It reuses the existing workspace-archive pattern ("Backend mints presigned URLs, envd uploads directly to object storage") but operates per file, so each file can be listed and downloaded independently.

### Sync path (write)

Triggered by an event when a subtask reaches a terminal state:

1. `StatusUpdatingEmitter` publishes `TaskCompletedEvent` when a subtask reaches a terminal state (DONE / ERROR / CANCELLED).
2. The `workspace_sync` event handler subscribes to it and reads `executor_name` / `executor_namespace` from the Subtask.
3. `WorkspaceSyncService` pulls a **manifest** from envd via the Executor Manager proxy: each file's relative path, size, mtime, and SHA-256.
4. The Backend diffs the manifest against the previous **snapshot**, producing "changed/new" and "deleted" file sets.
5. For changed files (skipping those over `WORKSPACE_SYNC_MAX_FILE_SIZE_MB`), it mints presigned PUT URLs and calls envd `POST /api/workspace/sync` so envd uploads directly to object storage.
6. For deleted files, the Backend removes the objects from storage directly.
7. The Backend persists the new snapshot (`relative_path -> sha256`) to object storage at `workspace-manifests/{task_id}.json`.

The Executor never holds object-storage credentials; the Backend mints all presigned URLs.

### Download path (read)

1. The frontend calls `GET /api/tasks/{task_id}/remote-workspace/tree` or `/remote-workspace/file`.
2. When the task's files have been synced, `remote_workspace_service`:
   - `list_tree`: lists the object-storage prefix `workspace/{task_id}/` and builds a one-level directory tree.
   - `stream_file`: mints a presigned GET URL for the existing object and returns a `302` redirect (through the gateway).
3. If object storage is not enabled or the file is not yet synced, it falls back to the envd live proxy (matching historical behavior).

The frontend `RemoteWorkspaceDialog` downloads/previews via `fetch(...).blob()`, which follows the `302` by default; browsers drop the `Authorization` header on cross-origin redirects, so the presigned URL works directly — identical to the attachment download path, requiring no extra changes.

## Object Storage Layout

| Purpose | Bucket | Key |
| --- | --- | --- |
| Workspace files | `WORKSPACE_FILES_BUCKET` (default `wegent-workspace-files`) | `workspace/{task_id}/{relative_path}` |
| Sync snapshot | same as above | `workspace-manifests/{task_id}.json` |

Relative paths are stored in POSIX form so object keys are identical regardless of the OS the Executor runs on.

### Sync root

envd selects the sync root by `runtime_type`, consistent with `remote_workspace_service` root resolution:

| runtime_type | Sync root |
| --- | --- |
| `executor` | `/workspace/{task_id}` |
| `sandbox` | `/home/user` |

### Exclusion rules

Sync and archive share one set of exclusion rules (`WORKSPACE_EXCLUDE_PATTERNS` in `executor/envd/api/workspace_files.py`) to avoid syncing large dependency and cache directories, for example:

- `node_modules`, `vendor`
- `.venv`, `venv`, `__pycache__`, `*.pyc`
- `build`, `dist`, `target`, `.next`, `.nuxt`
- `.cache`, `.npm`, `.pnpm-store`, `.yarn`
- `*.log`

## APIs

### envd

- `GET /api/workspace/manifest?task_id=&runtime_type=`: returns the workspace file manifest.
- `POST /api/workspace/sync`: uploads files to the presigned PUT URLs from the `{path, url}` list provided by the Backend.

### Executor Manager (proxy)

- `POST /executor/workspace/manifest`: resolves the target executor/sandbox address and forwards the manifest request.
- `POST /executor/workspace/sync`: forwards the sync request.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `WORKSPACE_SYNC_ENABLED` | `true` | Enable workspace file sync |
| `WORKSPACE_FILES_BUCKET` | `wegent-workspace-files` | Dedicated bucket for workspace files |
| `WORKSPACE_SYNC_MAX_FILE_SIZE_MB` | `100` | Per-file sync size limit (MB); larger files are skipped |
| `WORKSPACE_SYNC_PRESIGN_EXPIRE_SECONDS` | `3600` | Presigned URL lifetime (seconds) |

Sync also requires object storage to be configured (`is_external_storage_configured()` is true, i.e. `ATTACHMENT_S3_*` set).

## Unified Attachment Storage

Alongside this feature, attachment storage is consolidated to S3-only:

- `MySQLStorageBackend` is removed; only `s3` / `minio` backends remain, with `ATTACHMENT_STORAGE_BACKEND=s3` as the default.
- Skill / Plugin binaries are written to object storage uniformly through `SkillBinaryStorage`.
- Application-layer AES encryption is **kept** (the business-level encrypt/decrypt gateway controls egress of internal files), so encrypted-attachment downloads still stream through the Backend for decryption rather than a direct 302.

## Data Migration

Fresh projects need no migration: as long as `ATTACHMENT_S3_*` is configured, attachments, skills, plugins, and workspace files all land in object storage. Note there is no longer a MySQL fallback, so a fresh deployment **must** configure S3 or attachment upload/download will fail outright.

Existing projects (that previously ran with `ATTACHMENT_STORAGE_BACKEND=mysql`) must handle bytes left in the legacy `binary_data` column:

| Data type | Migration required | Why |
| --- | --- | --- |
| **Attachments** | **Required** | The download path `get_attachment_binary_data` only reads the storage backend and no longer falls back to the `binary_data` column, so un-migrated legacy attachments become **undownloadable** |
| **Skill / Plugin** | Optional | `SkillBinaryStorage.get_bytes` still has a dual path (`storage_key` → S3, else `binary_data`), so they keep working; migrating only drains MySQL fully |

Use the one-off migration script `backend/scripts/migrate_blobs_to_s3.py`:

```bash
cd backend
# Preview (no writes)
uv run python scripts/migrate_blobs_to_s3.py --dry-run
# Migrate attachments
uv run python scripts/migrate_blobs_to_s3.py
# Also migrate skills/plugins and verify uploaded size
uv run python scripts/migrate_blobs_to_s3.py --include-skills --verify
```

The script uploads the legacy bytes **verbatim** to S3 (encrypted attachments stay ciphertext; decryption is handled at the service layer by `is_encrypted`, so no decrypt/re-encrypt is needed), uses the existing `storage_key` as the object key, then flips `type_data.storage_backend` to `s3` and clears `binary_data`. It is idempotent, re-runnable, commits in id batches, and verifies object storage is configured before running.

Recommended rollout order: configure S3 → `--dry-run` to review → run the migration (optionally `--verify`) → spot-check that old attachments download → then cut over traffic.

> Note: this change does **not** modify the database schema; the `binary_data` columns are retained for legacy reads and migration. Once everything is migrated, you may optionally drop these LONGBLOB columns via a separate Alembic migration to slim down storage.
