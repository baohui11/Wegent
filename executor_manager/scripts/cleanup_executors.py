#!/usr/bin/env python

# SPDX-FileCopyrightText: 2025 WeCode, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Emergency cleanup tool for executor_manager-owned Docker containers.

Executor containers are launched as independent ``docker run -d`` containers
(label ``owner=executor_manager``), so they are NOT removed by
``docker compose down``. This script lets operators reap leftover containers.

Usage examples
--------------
    # Show what would be removed (dry run), terminal containers only:
    python cleanup_executors.py --dry-run

    # Remove only exited/dead/created containers (safe default):
    python cleanup_executors.py

    # Force-remove ALL owned containers, including running ones (dangerous):
    python cleanup_executors.py --all

    # Limit to a task type (e.g. only sandbox containers):
    python cleanup_executors.py --all --task-type sandbox

This script only uses the Docker CLI and has no project dependencies.
"""

import argparse
import subprocess
import sys

OWNER_LABEL = "owner=executor_manager"
TERMINAL_STATES = {"exited", "dead", "created"}


def _list_containers(task_type: str = None):
    """Return list of dicts: name, task_type, state for owned containers."""
    cmd = [
        "docker",
        "ps",
        "-a",
        "--filter",
        f"label={OWNER_LABEL}",
    ]
    if task_type:
        cmd.extend(["--filter", f"label=aigc.weibo.com/task-type={task_type}"])
    cmd.extend(
        ["--format", '{{.Names}}|{{.Label "aigc.weibo.com/task-type"}}|{{.State}}']
    )
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)

    containers = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 3:
            continue
        containers.append(
            {"name": parts[0], "task_type": parts[1] or "online", "state": parts[2]}
        )
    return containers


def _remove(name: str, force: bool) -> bool:
    cmd = ["docker", "rm"]
    if force:
        cmd.append("-f")
    cmd.append(name)
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"  failed to remove {name}: {e.stderr.strip()}", file=sys.stderr)
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Clean up executor_manager-owned Docker containers."
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Force-remove ALL owned containers, including running ones (dangerous).",
    )
    parser.add_argument(
        "--task-type",
        default=None,
        help="Only consider containers with this task-type label (e.g. sandbox).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be removed without removing anything.",
    )
    args = parser.parse_args()

    try:
        containers = _list_containers(args.task_type)
    except subprocess.CalledProcessError as e:
        print(f"docker error: {e.stderr.strip()}", file=sys.stderr)
        return 1

    if not containers:
        print("No executor_manager-owned containers found.")
        return 0

    targets = []
    for c in containers:
        state = (c["state"] or "").lower()
        is_terminal = state in TERMINAL_STATES
        if args.all or is_terminal:
            targets.append(c)

    if not targets:
        print(
            f"Found {len(containers)} owned container(s), none in a terminal state. "
            "Use --all to force-remove running containers."
        )
        return 0

    print(
        f"{'Would remove' if args.dry_run else 'Removing'} {len(targets)} container(s):"
    )
    removed = 0
    for c in targets:
        print(f"  - {c['name']} (task-type={c['task_type']}, state={c['state']})")
        if not args.dry_run:
            if _remove(c["name"], force=args.all):
                removed += 1

    if not args.dry_run:
        print(f"Removed {removed}/{len(targets)} container(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
