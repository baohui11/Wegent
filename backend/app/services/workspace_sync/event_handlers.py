# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Event-driven trigger for incremental workspace file sync.

Subscribes to :class:`TaskCompletedEvent` so that whenever a subtask reaches a
terminal state the executor workspace is synced to object storage. This is the
"checkpoint" that makes "view task files" serve everything from S3.
"""

import logging

from app.core.events import TaskCompletedEvent, get_event_bus

logger = logging.getLogger(__name__)


async def handle_task_completed_workspace_sync(event: TaskCompletedEvent) -> None:
    """Sync the task workspace to object storage on subtask completion."""
    from app.db.session import SessionLocal
    from app.models.subtask import Subtask
    from app.services.workspace_sync import workspace_sync_service

    if not workspace_sync_service.is_enabled():
        return

    executor_name = ""
    executor_namespace = ""
    db = SessionLocal()
    try:
        subtask = db.query(Subtask).filter(Subtask.id == event.subtask_id).first()
        if subtask is not None:
            executor_name = subtask.executor_name or ""
            executor_namespace = subtask.executor_namespace or ""
    except Exception as exc:
        logger.warning(
            "[workspace_sync] failed to load subtask %s for sync: %s",
            event.subtask_id,
            exc,
        )
    finally:
        db.close()

    # Do not bail when executor_name is empty: Chat Shell tasks run in a sandbox
    # runtime that the executor_manager resolves by task_id. sync_task_workspace
    # decides whether the runtime (sandbox vs executor) can actually be synced.
    try:
        await workspace_sync_service.sync_task_workspace(
            task_id=event.task_id,
            executor_name=executor_name,
            executor_namespace=executor_namespace,
        )
    except Exception as exc:
        # Never let sync failures affect task completion handling.
        logger.warning(
            "[workspace_sync] sync failed task_id=%s: %s", event.task_id, exc
        )


def register_workspace_sync_event_handlers() -> None:
    """Subscribe workspace sync handlers to the event bus."""
    event_bus = get_event_bus()
    event_bus.subscribe(TaskCompletedEvent, handle_task_completed_workspace_sync)
    logger.info("[workspace_sync] Subscribed to TaskCompletedEvent")
