---
sidebar_position: 29
---

# 工作区文件同步到对象存储

工作区文件同步（Workspace File Sync）让 Executor 在运行过程中产生的工作区文件，在每次子任务结束时增量同步到 S3 对象存储；前端「查看任务文件」的列表与下载随之统一走对象存储与加解密网关，与附件下载完全一致。

该机制解决了历史遗留问题：附件走 S3，而工作区文件却只能通过 Backend → Executor Manager → envd 代理实时读取，下载路径无法经过加解密网关，导致存储与访问链路割裂。

## 适用场景

- code task 与 chat task 在 Executor / Sandbox runtime 中产生的工作区文件。
- 用户在对话上方「查看任务文件」中浏览、预览、下载工作区文件。

同步是**增量**的：每次子任务到达终态时只上传发生变化的文件，并删除已被移除的文件。当 `WORKSPACE_SYNC_ENABLED` 关闭或对象存储未配置时，系统自动回退到原有的 envd 实时代理链路，行为完全向后兼容。

## 架构

整体复用工作区归档（archive）已有的「Backend 签发预签名 URL、envd 直传对象存储」模式，但以**单文件**粒度运行，使得每个文件都能被独立列举与下载。

### 同步链路（写）

子任务到达终态时由事件驱动触发：

1. `StatusUpdatingEmitter` 在子任务进入终态（DONE / ERROR / CANCELLED）时发布 `TaskCompletedEvent`。
2. `workspace_sync` 事件处理器订阅该事件，从 Subtask 读取 `executor_name` / `executor_namespace`。
3. `WorkspaceSyncService` 经 Executor Manager 代理向 envd 拉取**清单（manifest）**：每个文件的相对路径、大小、mtime、SHA-256。
4. Backend 将清单与上一次的**快照（snapshot）**做 diff，得到「变更/新增」与「删除」两类文件。
5. 对变更文件（跳过超过 `WORKSPACE_SYNC_MAX_FILE_SIZE_MB` 的大文件）签发预签名 PUT URL，调用 envd `POST /api/workspace/sync` 让 envd 直传对象存储。
6. 对删除文件，Backend 直接删除对象存储中的对象。
7. Backend 将新的快照（`相对路径 -> sha256`）持久化到对象存储 `workspace-manifests/{task_id}.json`。

Executor 全程不持有对象存储凭证，所有预签名 URL 都由 Backend 签发。

### 下载链路（读）

1. 前端调用 `GET /api/tasks/{task_id}/remote-workspace/tree` 或 `/remote-workspace/file`。
2. `remote_workspace_service` 在对象存储已同步该 task 文件时：
   - `list_tree`：列举对象存储前缀 `workspace/{task_id}/`，按目录层级构造一层目录树。
   - `stream_file`：对存在的对象签发预签名 GET URL，返回 `302` 重定向（经加解密网关）。
3. 若对象存储未启用或文件尚未同步，回退到 envd 实时代理（与历史行为一致）。

前端 `RemoteWorkspaceDialog` 使用 `fetch(...).blob()` 下载/预览，默认跟随 `302` 重定向，跨域时浏览器会丢弃 `Authorization` 头，因此预签名 URL 可直接生效——这与附件下载链路完全相同，无需额外改造。

## 对象存储布局

| 用途 | Bucket | Key |
| --- | --- | --- |
| 工作区文件 | `WORKSPACE_FILES_BUCKET`（默认 `wegent-workspace-files`） | `workspace/{task_id}/{相对路径}` |
| 同步快照 | 同上 | `workspace-manifests/{task_id}.json` |

相对路径以 POSIX 形式存储，因此无论 Executor 运行在何种操作系统，对象 Key 都一致。

### 同步根目录

envd 通过 `runtime_type` 选择同步根目录，与 `remote_workspace_service` 的根目录解析保持一致：

| runtime_type | 同步根目录 |
| --- | --- |
| `executor` | `/workspace/{task_id}` |
| `sandbox` | `/home/user` |

### 排除规则

同步与归档共用同一份排除规则（`executor/envd/api/workspace_files.py` 中的 `WORKSPACE_EXCLUDE_PATTERNS`），避免同步大体积依赖与缓存目录，例如：

- `node_modules`、`vendor`
- `.venv`、`venv`、`__pycache__`、`*.pyc`
- `build`、`dist`、`target`、`.next`、`.nuxt`
- `.cache`、`.npm`、`.pnpm-store`、`.yarn`
- `*.log`

## 接口

### envd

- `GET /api/workspace/manifest?task_id=&runtime_type=`：返回工作区文件清单。
- `POST /api/workspace/sync`：按 Backend 下发的 `{path, url}` 列表，将文件直传预签名 PUT URL。

### Executor Manager（代理）

- `POST /executor/workspace/manifest`：解析目标 executor/sandbox 地址后转发清单请求。
- `POST /executor/workspace/sync`：转发同步请求。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `WORKSPACE_SYNC_ENABLED` | `true` | 是否启用工作区文件同步 |
| `WORKSPACE_FILES_BUCKET` | `wegent-workspace-files` | 工作区文件专用 Bucket |
| `WORKSPACE_SYNC_MAX_FILE_SIZE_MB` | `100` | 单文件同步大小上限（MB），超过则跳过 |
| `WORKSPACE_SYNC_PRESIGN_EXPIRE_SECONDS` | `3600` | 预签名 URL 有效期（秒） |

同步还要求对象存储已正确配置（`is_external_storage_configured()` 为真，即 `ATTACHMENT_S3_*` 已设置）。

## 与附件存储统一

伴随该特性，附件存储统一收敛为 S3-only：

- 删除了 `MySQLStorageBackend`，存储后端只保留 `s3` / `minio`，默认 `ATTACHMENT_STORAGE_BACKEND=s3`。
- Skill / Plugin 二进制统一经 `SkillBinaryStorage` 写入对象存储。
- 应用层 AES 加解密**保留**（业务层加解密网关用于内部文件外发管控），因此加密附件下载仍经 Backend 流式解密，不直接 302。

## 数据迁移

全新项目无需迁移：只要配置好 `ATTACHMENT_S3_*`，附件、Skill、Plugin、工作区文件都会落到对象存储。注意默认已无 MySQL 兜底，全新部署**必须**配置 S3，否则附件上传/下载会直接失败。

已有项目（曾以 `ATTACHMENT_STORAGE_BACKEND=mysql` 运行）需要处理历史 `binary_data` 列中的字节：

| 数据类型 | 是否必须迁移 | 原因 |
| --- | --- | --- |
| **附件** | **必须** | 下载路径 `get_attachment_binary_data` 只走存储后端、不再回退读 `binary_data` 列，未迁移的旧附件将**无法下载** |
| **Skill / Plugin** | 可选 | `SkillBinaryStorage.get_bytes` 仍有双路径（`storage_key` → S3，否则读 `binary_data`），不迁也能读；迁移只为彻底清空 MySQL |

使用一次性迁移脚本 `backend/scripts/migrate_blobs_to_s3.py`：

```bash
cd backend
# 预览（不写入）
uv run python scripts/migrate_blobs_to_s3.py --dry-run
# 迁移附件
uv run python scripts/migrate_blobs_to_s3.py
# 同时迁移 Skill/Plugin 并校验上传大小
uv run python scripts/migrate_blobs_to_s3.py --include-skills --verify
```

脚本将旧字节**原样**上传到 S3（加密附件仍是密文，解密统一在 service 层按 `is_encrypted` 处理，无需解密/重加密），按原 `storage_key` 作为对象 Key，再把 `type_data.storage_backend` 改为 `s3` 并清空 `binary_data`。脚本幂等、可重复运行、按 id 分批提交，运行前会校验对象存储是否已配置。

建议上线顺序：配好 S3 → `--dry-run` 核对清单 → 执行迁移（必要时 `--verify`）→ 抽查旧附件下载正常 → 再切流。

> 注：本次改动**未修改数据库表结构**，`binary_data` 列仍保留以兼容旧数据读取与迁移。待全部迁移完成后，可另行通过 Alembic 迁移 drop 掉这些 LONGBLOB 列以瘦身（可选，独立进行）。
