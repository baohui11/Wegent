---
sidebar_position: 17
---

# Runtime Cleanup

Runtime cleanup manually removes execution environments that have not been updated for a configured period. It only deletes runtime Pods or containers. It does not delete Backend Task records or message history.

## API

```http
POST /api/admin/runtime-cleanup/stale
```

This endpoint is admin-only.

Request body:

```json
{
  "task_id": 123,
  "inactive_hours": 24,
  "dry_run": false,
  "archive_before_delete": true
}
```

This endpoint only cleans up the runtime for one Task ID. It does not provide full cleanup.

When calling with `curl`, set the JSON Content-Type:

```bash
curl "https://<host>/api/admin/runtime-cleanup/stale" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"task_id":123,"inactive_hours":24,"dry_run":false,"archive_before_delete":true}'
```

Fields:

| Field | Description | Default |
|-------|-------------|---------|
| `task_id` | Task ID whose runtime should be cleaned up. Required. | - |
| `inactive_hours` | Minimum inactive hours before deletion is allowed | `24` |
| `dry_run` | Return the planned result without deleting runtimes | `false` |
| `archive_before_delete` | Archive the sandbox workspace before deleting it | `true` |

## Rules

The endpoint only processes the specified task:

- If a sandbox with the same ID exists, the sandbox `last_activity_at` timestamp decides whether it is stale.
- If no sandbox exists, the Task/Subtask update timestamps decide whether the task executor is stale.
- If the runtime is newer than `inactive_hours`, it is not deleted and returns `reason: "not_stale"`.
- Tasks with `preserveExecutor=true` are not deleted.
- Device executors are not deleted by this endpoint.
- Successful executor deletion marks related Subtasks with `executor_deleted_at=true`.
- Sandbox deletion is performed by Executor Manager and archives the workspace first by default.

## Response Example

```json
{
  "task_id": 123,
  "inactive_hours": 24,
  "dry_run": false,
  "archive_before_delete": true,
  "results": {
    "task_executor": {
      "task_id": 123,
      "deleted": false,
      "skipped": true,
      "reason": "not_stale",
      "executors": [],
      "last_updated_at": "2026-05-18T10:30:00",
      "eligible_after": "2026-05-19T10:30:00"
    }
  }
}
```

## Automatic Cleanup

Beyond the manual API above, several layers of automatic cleanup guarantee that executor containers are eventually released.

### Container lifecycle prerequisite

In Docker mode, executor containers are launched by Executor Manager as **independent `docker run -d` containers** on the host Docker daemon (labeled `owner=executor_manager`). They are **not** Docker Compose services.

⚠️ As a result, `docker compose down executor_manager` does **not** stop these executor containers — they keep running until reaped by the mechanisms below. This is intentional: restarting Executor Manager must not abort in-flight tasks (task results are delivered to the Backend directly via callbacks).

### Three cleanup layers

| Layer | Owner | Trigger | Configuration |
|-------|-------|---------|---------------|
| Backend scheduled deletion | Backend job | Task/Subtask `updated_at` older than threshold (**minutes**) | `CHAT_TASK_EXECUTOR_DELETE_AFTER_MINUTES` (default 120), `CODE_TASK_EXECUTOR_DELETE_AFTER_MINUTES` (default 1440), `STALE_NON_TERMINAL_TASK_EXECUTOR_DELETE_AFTER_MINUTES` (default 1440) |
| Idle GC (safety net) | Executor Manager | Container has **no active task** and is idle beyond the threshold, **DB-independent** | `EXECUTOR_IDLE_TIMEOUT_MINUTES` (default 30), `EXECUTOR_IDLE_GC_INTERVAL_SECONDS` (default 120) |
| Startup reconcile | Executor Manager | On boot, removes orphaned containers in `exited`/`dead`/`created` terminal state | automatic |

> **Minutes-based timeout**: executor auto-delete thresholds are all expressed in **minutes**, so you can set sub-hour values (e.g. 20) for faster container release.

**Idle GC reliability**: "busy" is derived from `RunningTaskTracker` (the running-task set in Redis) — every non-sandbox/validation task is registered at dispatch and cleared on completion/cancellation/death. A container running a task (even a long-running code task) is therefore never reaped by mistake; only containers idle (no active task) beyond the threshold are removed. This layer does not depend on the Backend database, making it the ultimate safety net against DB state drift, `compose down` orphans, etc.

**Protection label**: tasks with `preserveExecutor=true` produce containers labeled `preserve_executor=true`, which the idle GC never reaps. Sandbox and validation containers are managed by their own lifecycles and are skipped by the idle GC.

### Sandbox idle reclamation

Sandbox containers are reclaimed by the Executor Manager GC based on `last_activity_at`. The idle TTL is configured via `SANDBOX_IDLE_TIMEOUT_MINUTES` (default 1440, i.e. 24 hours) and can be set to minute-level values.

### Manual cleanup script

For emergencies (e.g. many containers orphaned by `compose down`), use the bundled script to bulk-remove containers:

```bash
# Preview what would be removed (no deletion)
python executor_manager/scripts/cleanup_executors.py --dry-run

# Remove only exited (terminal) containers (safe default)
python executor_manager/scripts/cleanup_executors.py

# Force-remove ALL owner=executor_manager containers, incl. running (dangerous)
python executor_manager/scripts/cleanup_executors.py --all

# Limit to a task type (e.g. sandbox)
python executor_manager/scripts/cleanup_executors.py --all --task-type sandbox
```
