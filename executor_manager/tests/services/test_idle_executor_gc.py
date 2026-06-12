# SPDX-FileCopyrightText: 2025 WeCode, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for the idle executor garbage collector."""

import time

import pytest


class _FakeHashRedis:
    """Minimal Redis stand-in supporting the hash ops the GC uses."""

    def __init__(self):
        self.hashes = {}

    def hset(self, key, field, value):
        self.hashes.setdefault(key, {})[field] = value

    def hget(self, key, field):
        return self.hashes.get(key, {}).get(field)

    def hdel(self, key, *fields):
        h = self.hashes.get(key, {})
        for f in fields:
            h.pop(f, None)

    def hkeys(self, key):
        return list(self.hashes.get(key, {}).keys())


class _AlwaysLock:
    def acquire(self, *_args, **_kwargs):
        return True

    def release(self, *_args, **_kwargs):
        return True


class _FakeTracker:
    def __init__(self, busy_map):
        # busy_map: {task_id_str: executor_name}
        self._busy = busy_map

    def get_running_task_ids(self):
        return list(self._busy.keys())

    def get_task_metadata(self, task_id):
        name = self._busy.get(str(task_id))
        return {"executor_name": name} if name else None


@pytest.fixture
def gc_module(mocker):
    """Import the GC module with redis + lock patched, return (module, gc, calls)."""
    import executor_manager.services.idle_executor_gc as module

    module._idle_executor_gc = None

    mocker.patch(
        "executor_manager.common.redis_factory.RedisClientFactory.get_sync_client",
        return_value=_FakeHashRedis(),
    )
    mocker.patch.object(module, "get_distributed_lock", return_value=_AlwaysLock())

    deleted = []
    mocker.patch.object(
        module,
        "delete_container",
        side_effect=lambda name: deleted.append(name) or {"status": "success"},
    )

    gc = module.get_idle_executor_gc()
    gc._redis = _FakeHashRedis()
    return module, gc, deleted


def _set_busy(module, mocker, busy_map):
    mocker.patch.object(
        module, "get_running_task_tracker", return_value=_FakeTracker(busy_map)
    )


def test_busy_container_not_reaped(gc_module, mocker):
    module, gc, deleted = gc_module
    mocker.patch.object(module, "IDLE_TIMEOUT_MINUTES", 30)
    _set_busy(module, mocker, {"1": "wegent-task-alice-abc"})
    mocker.patch.object(
        module,
        "list_owned_containers",
        return_value=[
            {
                "name": "wegent-task-alice-abc",
                "task_type": "online",
                "preserve": "false",
                "state": "running",
            }
        ],
    )

    reaped = gc.collect_idle_executors()

    assert reaped == 0
    assert deleted == []
    # Busy container's idle clock was refreshed.
    assert gc._get_last_active("wegent-task-alice-abc") is not None


def test_idle_container_reaped_after_ttl(gc_module, mocker):
    module, gc, deleted = gc_module
    mocker.patch.object(module, "IDLE_TIMEOUT_MINUTES", 20)
    _set_busy(module, mocker, {})  # nothing busy
    mocker.patch.object(
        module,
        "list_owned_containers",
        return_value=[
            {
                "name": "wegent-task-bob-xyz",
                "task_type": "online",
                "preserve": "false",
                "state": "running",
            }
        ],
    )
    # Seed an idle timestamp older than the 20-minute TTL.
    gc._touch("wegent-task-bob-xyz", time.time() - 21 * 60)

    reaped = gc.collect_idle_executors()

    assert reaped == 1
    assert deleted == ["wegent-task-bob-xyz"]
    assert gc._get_last_active("wegent-task-bob-xyz") is None


def test_first_observation_starts_clock_not_reaped(gc_module, mocker):
    module, gc, deleted = gc_module
    mocker.patch.object(module, "IDLE_TIMEOUT_MINUTES", 20)
    _set_busy(module, mocker, {})
    mocker.patch.object(
        module,
        "list_owned_containers",
        return_value=[
            {
                "name": "wegent-task-new-001",
                "task_type": "online",
                "preserve": "false",
                "state": "running",
            }
        ],
    )

    reaped = gc.collect_idle_executors()

    assert reaped == 0
    assert deleted == []
    # Clock started; a full TTL must elapse before reaping.
    assert gc._get_last_active("wegent-task-new-001") is not None


def test_sandbox_and_preserve_are_skipped(gc_module, mocker):
    module, gc, deleted = gc_module
    mocker.patch.object(module, "IDLE_TIMEOUT_MINUTES", 1)
    _set_busy(module, mocker, {})
    mocker.patch.object(
        module,
        "list_owned_containers",
        return_value=[
            {
                "name": "wegent-task-sb-1",
                "task_type": "sandbox",
                "preserve": "false",
                "state": "running",
            },
            {
                "name": "wegent-task-keep-1",
                "task_type": "online",
                "preserve": "true",
                "state": "running",
            },
        ],
    )
    # Even with old idle stamps, these must never be reaped.
    gc._touch("wegent-task-sb-1", time.time() - 3600)
    gc._touch("wegent-task-keep-1", time.time() - 3600)

    reaped = gc.collect_idle_executors()

    assert reaped == 0
    assert deleted == []
    # Excluded containers have their tracking entries cleared.
    assert gc._get_last_active("wegent-task-sb-1") is None
    assert gc._get_last_active("wegent-task-keep-1") is None


def test_disabled_when_timeout_non_positive(gc_module, mocker):
    module, gc, deleted = gc_module
    mocker.patch.object(module, "IDLE_TIMEOUT_MINUTES", 0)
    _set_busy(module, mocker, {})
    spy = mocker.patch.object(module, "list_owned_containers", return_value=[])

    reaped = gc.collect_idle_executors()

    assert reaped == 0
    spy.assert_not_called()


def test_reconcile_removes_terminal_containers(gc_module, mocker):
    module, gc, deleted = gc_module
    mocker.patch.object(module, "IDLE_TIMEOUT_MINUTES", 30)
    _set_busy(module, mocker, {})

    def fake_list(running_only=True):
        if running_only:
            return []
        return [
            {
                "name": "wegent-task-dead-1",
                "task_type": "online",
                "preserve": "false",
                "state": "exited",
            },
            {
                "name": "wegent-task-run-1",
                "task_type": "online",
                "preserve": "false",
                "state": "running",
            },
            {
                "name": "wegent-task-val-1",
                "task_type": "validation",
                "preserve": "false",
                "state": "exited",
            },
        ]

    mocker.patch.object(module, "list_owned_containers", side_effect=fake_list)

    removed = gc.reconcile_on_startup()

    # Only the exited non-validation container is removed at startup.
    assert removed == 1
    assert deleted == ["wegent-task-dead-1"]
