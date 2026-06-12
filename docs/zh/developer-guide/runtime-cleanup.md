---
sidebar_position: 17
---

# 运行时清理

运行时清理接口用于手动清理长时间无更新的执行环境。它只删除运行时 Pod/容器，不删除 Backend 中的 Task 记录和历史消息。

## 接口

```http
POST /api/admin/runtime-cleanup/stale
```

该接口仅管理员可用。

请求体：

```json
{
  "task_id": 123,
  "inactive_hours": 24,
  "dry_run": false,
  "archive_before_delete": true
}
```

该接口只支持按 Task ID 清理单个任务的运行时，不提供全量清理能力。

使用 `curl` 调用时必须声明 JSON Content-Type：

```bash
curl "https://<host>/api/admin/runtime-cleanup/stale" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"task_id":123,"inactive_hours":24,"dry_run":false,"archive_before_delete":true}'
```

字段说明：

| 字段 | 描述 | 默认值 |
|------|------|--------|
| `task_id` | 要清理运行时的 Task ID，必填 | - |
| `inactive_hours` | 无更新或无活动达到多少小时后才允许删除 | `24` |
| `dry_run` | 只返回将执行的结果，不实际删除 | `false` |
| `archive_before_delete` | 删除 sandbox 前是否先归档工作区 | `true` |

## 清理规则

接口只处理指定任务：

- 如果存在同 ID 的 sandbox，则按 sandbox 的 `last_activity_at` 判断是否过期。
- 如果不存在 sandbox，则按 Task/Subtask 的更新时间判断 task executor 是否过期。
- 未达到 `inactive_hours` 时不会删除，返回 `reason: "not_stale"`。
- 设置了 `preserveExecutor=true` 的任务不会删除。
- device executor 不会通过该接口删除。
- executor 删除成功后会标记相关 Subtask 的 `executor_deleted_at=true`。
- sandbox 删除由 Executor Manager 执行，默认会先归档工作区再删除。

## 返回示例

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

## 自动清理机制

除了上面的手动接口，系统还有多层自动清理机制保证执行容器最终一定会被释放。

### 容器生命周期前提

Docker 模式下，executor 容器是 Executor Manager 用 `docker run -d` 在宿主 Docker 守护进程上启动的**独立容器**（带 `owner=executor_manager` 标签），**不是** Docker Compose 服务。

⚠️ 因此 `docker compose down executor_manager` **不会**停止这些 executor 容器，它们会继续运行直到被下面的清理机制回收。这是有意设计：Executor Manager 重启时不应中断正在执行的任务（任务结果通过回调直接发给 Backend）。

### 三层自动清理

| 层级 | 执行者 | 判定依据 | 配置 |
|------|--------|----------|------|
| Backend 定时删除 | Backend 调度任务 | Task/Subtask `updated_at` 超过阈值（**分钟**） | `CHAT_TASK_EXECUTOR_DELETE_AFTER_MINUTES`（默认 120）、`CODE_TASK_EXECUTOR_DELETE_AFTER_MINUTES`（默认 1440）、`STALE_NON_TERMINAL_TASK_EXECUTOR_DELETE_AFTER_MINUTES`（默认 1440） |
| 空闲 GC（兜底） | Executor Manager | 容器**当前无运行中任务**且空闲超过阈值，**不依赖数据库** | `EXECUTOR_IDLE_TIMEOUT_MINUTES`（默认 30）、`EXECUTOR_IDLE_GC_INTERVAL_SECONDS`（默认 120） |
| 启动 reconcile | Executor Manager | 启动时回收处于 `exited`/`dead`/`created` 终态的孤儿容器 | 自动执行 |

> **超时改为分钟**：执行容器的自动删除阈值统一使用**分钟**，可设置成 20 分钟等小于 1 小时的值，以更快释放容器。

**空闲 GC 的可靠性**：是否「忙碌」由 `RunningTaskTracker`（Redis 中的运行任务集合）判定——每个非 sandbox/validation 任务在派发时登记、完成/取消/崩溃时清除。因此正在执行（即使是长时间运行的 code 任务）的容器永远不会被误删；只有任务结束后空闲超过阈值的容器才会被回收。该机制不依赖 Backend 数据库，是数据库状态漂移、`compose down` 遗留等场景下的最终兜底。

**保护标签**：设置了 `preserveExecutor=true` 的任务，其容器会带上 `preserve_executor=true` 标签，空闲 GC 永不回收。sandbox 与 validation 容器由各自的生命周期管理，空闲 GC 会跳过。

### Sandbox 空闲回收

Sandbox 容器由 Executor Manager 的 GC 按 `last_activity_at` 回收，空闲 TTL 通过 `SANDBOX_IDLE_TIMEOUT_MINUTES`（默认 1440，即 24 小时）配置，可设置成分钟级。

### 手动一键清理脚本

应急场景（如大量 `compose down` 遗留容器）可使用脚本批量清理：

```bash
# 预览将清理的容器（不实际删除）
python executor_manager/scripts/cleanup_executors.py --dry-run

# 仅删除已退出（终态）容器（安全默认）
python executor_manager/scripts/cleanup_executors.py

# 强制删除全部 owner=executor_manager 容器（含运行中，慎用）
python executor_manager/scripts/cleanup_executors.py --all

# 仅清理某一类型（如 sandbox）
python executor_manager/scripts/cleanup_executors.py --all --task-type sandbox
```
