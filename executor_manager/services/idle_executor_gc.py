# SPDX-FileCopyrightText: 2025 WeCode, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Idle executor garbage collector for Docker mode.

This module reaps regular task executor containers that are no longer running
any task, independently of the Backend database. It is the authoritative,
self-contained safety net that guarantees idle containers are eventually
released even when:

- ``docker compose down`` orphaned the containers (manager was offline);
- the Backend cleanup job never runs or its DB rows drift out of sync;
- a container keeps running after its task finished (kept warm for reuse).

Reliability model
------------------
"Busy" is derived from :class:`RunningTaskTracker`, which executor_manager
populates for every non-sandbox / non-validation task at dispatch time and
clears on completion / cancellation / death. A container that maps to an
active task is therefore never reaped, no matter how long the task runs.
Containers that are NOT busy for longer than the configured idle timeout are
removed.

Sandbox containers (``task-type=sandbox``) and validation containers
(``task-type=validation``) have their own lifecycles and are skipped here.
Containers explicitly marked ``preserve_executor=true`` are also skipped.
"""

import os
import time
from typing import Optional, Set

import redis

from executor_manager.common.distributed_lock import get_distributed_lock
from executor_manager.common.redis_factory import RedisClientFactory
from executor_manager.executors.docker.utils import (
    delete_container,
    list_owned_containers,
)
from executor_manager.services.task_heartbeat_manager import get_running_task_tracker
from shared.logger import setup_logger

logger = setup_logger(__name__)

# Idle timeout: a non-busy task container older than this (in minutes) is reaped.
IDLE_TIMEOUT_MINUTES = int(os.getenv("EXECUTOR_IDLE_TIMEOUT_MINUTES", "30"))
# How often the periodic idle GC runs.
IDLE_GC_INTERVAL_SECONDS = int(os.getenv("EXECUTOR_IDLE_GC_INTERVAL_SECONDS", "120"))

# Redis hash tracking the last time each executor was observed busy (or first
# observed idle). Field = container name, value = unix timestamp.
LAST_ACTIVE_HASH = "wegent:executor-idle:last_active"

# Only regular task executors carry this name prefix; sandboxes share it too but
# are filtered out by task-type. Device executors use a different prefix.
TASK_CONTAINER_PREFIX = "wegent-task-"

# Task types whose containers are managed by a different lifecycle.
EXCLUDED_TASK_TYPES = {"sandbox", "validation"}

# Docker states considered terminal (safe to remove during startup reconcile).
TERMINAL_STATES = {"exited", "dead", "created"}


class IdleExecutorGC:
    """Reap idle / orphaned regular task executor containers."""

    def __init__(self) -> None:
        self._redis: Optional[redis.Redis] = RedisClientFactory.get_sync_client()

    # ------------------------------------------------------------------ helpers
    def _busy_executor_names(self) -> Set[str]:
        """Return the set of container names that currently run an active task."""
        tracker = get_running_task_tracker()
        names: Set[str] = set()
        for task_id_str in tracker.get_running_task_ids():
            try:
                task_id = int(task_id_str)
            except (TypeError, ValueError):
                continue
            meta = tracker.get_task_metadata(task_id)
            if meta and meta.get("executor_name"):
                names.add(meta["executor_name"])
        return names

    def _touch(self, name: str, ts: float) -> None:
        if self._redis is None:
            return
        try:
            self._redis.hset(LAST_ACTIVE_HASH, name, str(ts))
        except Exception as e:
            logger.debug(f"[IdleExecutorGC] Failed to touch {name}: {e}")

    def _clear(self, name: str) -> None:
        if self._redis is None:
            return
        try:
            self._redis.hdel(LAST_ACTIVE_HASH, name)
        except Exception as e:
            logger.debug(f"[IdleExecutorGC] Failed to clear {name}: {e}")

    def _get_last_active(self, name: str) -> Optional[float]:
        if self._redis is None:
            return None
        try:
            value = self._redis.hget(LAST_ACTIVE_HASH, name)
            if value is None:
                return None
            if isinstance(value, bytes):
                value = value.decode()
            return float(value)
        except Exception:
            return None

    def _prune_missing(self, present: Set[str]) -> None:
        """Drop tracking entries for containers that no longer exist."""
        if self._redis is None:
            return
        try:
            existing = self._redis.hkeys(LAST_ACTIVE_HASH)
            stale = []
            for key in existing:
                name = key.decode() if isinstance(key, bytes) else key
                if name not in present:
                    stale.append(name)
            if stale:
                self._redis.hdel(LAST_ACTIVE_HASH, *stale)
        except Exception as e:
            logger.debug(f"[IdleExecutorGC] Failed to prune tracking hash: {e}")

    @staticmethod
    def _is_reapable(container: dict) -> bool:
        """Whether this container is a regular task executor the GC may manage."""
        name = container.get("name", "")
        if not name.startswith(TASK_CONTAINER_PREFIX):
            return False
        if container.get("task_type") in EXCLUDED_TASK_TYPES:
            return False
        if container.get("preserve") == "true":
            return False
        return True

    # -------------------------------------------------------------- public API
    def collect_idle_executors(self) -> int:
        """Reap running task containers idle longer than the configured timeout.

        Returns:
            Number of containers removed.
        """
        if IDLE_TIMEOUT_MINUTES <= 0:
            return 0

        lock = get_distributed_lock()
        if not lock.acquire(
            "idle_executor_gc", expire_seconds=IDLE_GC_INTERVAL_SECONDS
        ):
            logger.debug(
                "[IdleExecutorGC] Idle GC already running on another instance, skipping"
            )
            return 0

        reaped = 0
        try:
            containers = list_owned_containers(running_only=True)
            busy = self._busy_executor_names()
            now = time.time()
            ttl_seconds = IDLE_TIMEOUT_MINUTES * 60
            present: Set[str] = set()

            for container in containers:
                name = container["name"]
                if not name.startswith(TASK_CONTAINER_PREFIX):
                    continue
                present.add(name)

                # Containers with a different lifecycle: never reap, keep clean.
                if (
                    container.get("task_type") in EXCLUDED_TASK_TYPES
                    or container.get("preserve") == "true"
                ):
                    self._clear(name)
                    continue

                if name in busy:
                    # Active task -> keep alive, reset the idle clock.
                    self._touch(name, now)
                    continue

                last_active = self._get_last_active(name)
                if last_active is None:
                    # First time we observe this container idle: start the clock
                    # conservatively so it always gets a full idle window.
                    self._touch(name, now)
                    continue

                idle_for = now - last_active
                if idle_for >= ttl_seconds:
                    result = delete_container(name)
                    if result.get("status") == "success":
                        reaped += 1
                        self._clear(name)
                        logger.info(
                            f"[IdleExecutorGC] Reaped idle executor {name} "
                            f"(idle {idle_for / 60:.1f} min >= {IDLE_TIMEOUT_MINUTES} min)"
                        )
                    else:
                        logger.warning(
                            f"[IdleExecutorGC] Failed to reap idle executor {name}: "
                            f"{result.get('error_msg')}"
                        )

            self._prune_missing(present)

            if reaped:
                logger.info(f"[IdleExecutorGC] Reaped {reaped} idle executor(s)")
        except Exception as e:
            logger.error(f"[IdleExecutorGC] Idle GC run failed: {e}")
        finally:
            lock.release("idle_executor_gc")

        return reaped

    def reconcile_on_startup(self) -> int:
        """Remove terminal/orphaned containers left over from a previous run.

        Called once when executor_manager boots. This addresses containers left
        behind by ``docker compose down`` (or a crash): exited/dead containers
        are removed immediately, while still-running containers are left to the
        periodic idle GC (they may legitimately still be completing a task whose
        callback goes directly to the Backend).

        Validation containers are preserved so VALIDATION_KEEP_FAILED_CONTAINER
        debugging still works.

        Returns:
            Number of terminal containers removed.
        """
        removed = 0
        try:
            containers = list_owned_containers(running_only=False)
            for container in containers:
                name = container["name"]
                if not name.startswith(TASK_CONTAINER_PREFIX):
                    continue
                if container.get("task_type") == "validation":
                    continue
                state = (container.get("state") or "").lower()
                if state in TERMINAL_STATES:
                    result = delete_container(name)
                    if result.get("status") == "success":
                        removed += 1
                        self._clear(name)
                        logger.info(
                            f"[IdleExecutorGC] Startup reconcile removed terminal "
                            f"container {name} (state={state})"
                        )
            if removed:
                logger.info(
                    f"[IdleExecutorGC] Startup reconcile removed {removed} "
                    f"terminal container(s)"
                )
        except Exception as e:
            logger.error(f"[IdleExecutorGC] Startup reconcile failed: {e}")

        # Prime the idle tracker for currently-running containers.
        self.collect_idle_executors()
        return removed


_idle_executor_gc: Optional[IdleExecutorGC] = None


def get_idle_executor_gc() -> IdleExecutorGC:
    """Get the global IdleExecutorGC instance."""
    global _idle_executor_gc
    if _idle_executor_gc is None:
        _idle_executor_gc = IdleExecutorGC()
    return _idle_executor_gc
