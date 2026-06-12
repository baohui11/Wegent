#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
One-off migration: move legacy MySQL binary blobs into S3 object storage.

Background
----------
Attachment / skill / plugin binaries used to be stored in MySQL ``LONGBLOB``
columns. Storage is now S3-only (the MySQL storage backend was removed), so any
existing deployment that previously ran with ``ATTACHMENT_STORAGE_BACKEND=mysql``
has legacy rows whose bytes live only in MySQL.

- Attachments: the download path no longer reads the ``binary_data`` column, so
  legacy attachments become **unreadable** until migrated. (Required.)
- Skills / plugins: ``SkillBinaryStorage.get_bytes`` still has a dual-path read
  (``storage_key`` -> S3, else ``binary_data``), so they keep working. Migrating
  them is **optional** but lets you fully drain MySQL. (Use ``--include-skills``.)

What it does
------------
For each legacy attachment it copies the raw bytes (which stay AES-encrypted if
they were encrypted; decryption happens at the service layer on read) to S3
under the same ``storage_key``, flips ``type_data.storage_backend`` to ``s3``,
and clears the ``binary_data`` column. Idempotent and safe to re-run.

Usage
-----
    cd backend
    # Preview only (no writes):
    uv run python scripts/migrate_blobs_to_s3.py --dry-run
    # Migrate attachments:
    uv run python scripts/migrate_blobs_to_s3.py
    # Also migrate skill/plugin binaries and verify uploads:
    uv run python scripts/migrate_blobs_to_s3.py --include-skills --verify

Requires the ATTACHMENT_S3_* settings to be configured.
"""

import argparse
import hashlib
import os
import sys
from pathlib import Path
from typing import Optional

# Add backend to path and load environment, mirroring other scripts.
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from sqlalchemy.orm import Session  # noqa: E402
from sqlalchemy.orm.attributes import flag_modified  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.subtask_context import ContextType, SubtaskContext  # noqa: E402
from app.services.attachment.s3_storage import S3StorageBackend  # noqa: E402
from app.services.attachment.storage_backend import generate_storage_key  # noqa: E402
from app.services.attachment.storage_factory import (  # noqa: E402
    is_external_storage_configured,
)

# Backends that count as "already on object storage".
_OBJECT_BACKENDS = {"s3", "minio"}


class MigrationStats:
    """Mutable counters for a migration run."""

    def __init__(self) -> None:
        self.scanned = 0
        self.migrated = 0
        self.skipped = 0
        self.failed = 0

    def summary(self, label: str) -> str:
        return (
            f"[{label}] scanned={self.scanned} migrated={self.migrated} "
            f"skipped={self.skipped} failed={self.failed}"
        )


def _attachment_object_key(context: SubtaskContext) -> str:
    """Return the S3 key to store an attachment under.

    Reuses the existing ``storage_key`` when present so the read path
    (``context.storage_key``) keeps resolving; otherwise mints a deterministic
    one and writes it back into ``type_data``.
    """
    existing = context.storage_key
    if existing:
        return existing
    return generate_storage_key(
        attachment_id=context.id,
        user_id=context.user_id,
        file_extension=context.file_extension,
    )


def migrate_attachments(
    db: Session,
    backend: S3StorageBackend,
    *,
    dry_run: bool,
    batch_size: int,
    verify: bool,
) -> MigrationStats:
    """Migrate legacy MySQL attachment blobs to S3, paginating by id."""
    stats = MigrationStats()
    last_id = 0

    while True:
        batch = (
            db.query(SubtaskContext)
            .filter(
                SubtaskContext.context_type == ContextType.ATTACHMENT.value,
                SubtaskContext.id > last_id,
            )
            .order_by(SubtaskContext.id)
            .limit(batch_size)
            .all()
        )
        if not batch:
            break

        for context in batch:
            last_id = context.id
            stats.scanned += 1
            _migrate_one_attachment(
                db, backend, context, stats, dry_run=dry_run, verify=verify
            )

        if not dry_run:
            db.commit()

    return stats


def _migrate_one_attachment(
    db: Session,
    backend: S3StorageBackend,
    context: SubtaskContext,
    stats: MigrationStats,
    *,
    dry_run: bool,
    verify: bool,
) -> None:
    """Migrate a single attachment row; updates ``stats`` in place."""
    if context.storage_backend in _OBJECT_BACKENDS:
        stats.skipped += 1
        return

    data = context.binary_data
    if not data:
        # Nothing to move (e.g. text-only context or already drained).
        stats.skipped += 1
        return

    key = _attachment_object_key(context)
    if dry_run:
        print(
            f"  [dry-run] would migrate context id={context.id} -> {key} "
            f"({len(data)} bytes)"
        )
        stats.migrated += 1
        return

    try:
        backend.save(key, data, {"mime_type": context.mime_type})
        if verify and backend.get_size(key) != len(data):
            raise RuntimeError("verify failed: uploaded size mismatch")

        new_type_data = dict(context.type_data or {})
        new_type_data["storage_backend"] = "s3"
        new_type_data["storage_key"] = key
        context.type_data = new_type_data
        flag_modified(context, "type_data")
        context.binary_data = b""
        stats.migrated += 1
        print(f"  migrated context id={context.id} -> {key} ({len(data)} bytes)")
    except Exception as exc:  # noqa: BLE001 - report and continue
        stats.failed += 1
        print(f"  FAILED context id={context.id}: {exc}")


def migrate_skill_binaries(
    db: Session,
    *,
    dry_run: bool,
    batch_size: int,
) -> MigrationStats:
    """Migrate legacy skill/plugin blobs via the shared storage facade."""
    # Imported lazily so attachment-only runs don't require it.
    from app.models.skill_binary import SkillBinary
    from app.services.skill_binary_storage import skill_binary_storage

    stats = MigrationStats()
    last_id = 0

    while True:
        batch = (
            db.query(SkillBinary)
            .filter(SkillBinary.id > last_id)
            .order_by(SkillBinary.id)
            .limit(batch_size)
            .all()
        )
        if not batch:
            break

        for record in batch:
            last_id = record.id
            stats.scanned += 1
            _migrate_one_skill_binary(
                db, skill_binary_storage, record, stats, dry_run=dry_run
            )

        if not dry_run:
            db.commit()

    return stats


def _migrate_one_skill_binary(
    db: Session,
    skill_binary_storage,
    record,
    stats: MigrationStats,
    *,
    dry_run: bool,
) -> None:
    """Migrate a single SkillBinary row; updates ``stats`` in place."""
    if record.storage_key:
        stats.skipped += 1
        return

    data = record.binary_data
    if not data:
        stats.skipped += 1
        return

    if dry_run:
        print(
            f"  [dry-run] would migrate skill_binary kind_id={record.kind_id} "
            f"({len(data)} bytes)"
        )
        stats.migrated += 1
        return

    try:
        file_hash = record.file_hash or hashlib.sha256(data).hexdigest()
        skill_binary_storage.save(
            db,
            kind_id=record.kind_id,
            file_content=data,
            file_size=record.file_size or len(data),
            file_hash=file_hash,
            file_name=record.file_name,
            binary_type=record.type,
        )
        stats.migrated += 1
        print(f"  migrated skill_binary kind_id={record.kind_id} ({len(data)} bytes)")
    except Exception as exc:  # noqa: BLE001 - report and continue
        stats.failed += 1
        print(f"  FAILED skill_binary kind_id={record.kind_id}: {exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate legacy MySQL binary blobs to S3 object storage."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be migrated without writing to S3 or the DB.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Rows processed per DB commit (default: 50).",
    )
    parser.add_argument(
        "--include-skills",
        action="store_true",
        help="Also migrate skill/plugin binaries (optional; they still read "
        "from MySQL otherwise).",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="After each upload, stat the object and confirm the byte size.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not is_external_storage_configured():
        print(
            "ERROR: object storage is not configured. Set ATTACHMENT_S3_ENDPOINT, "
            "ATTACHMENT_S3_ACCESS_KEY and ATTACHMENT_S3_SECRET_KEY before running."
        )
        return 1

    mode = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"Starting blob migration ({mode}) -> bucket={settings.ATTACHMENT_S3_BUCKET}")

    db = SessionLocal()
    try:
        backend = S3StorageBackend(db=db, bucket=settings.ATTACHMENT_S3_BUCKET)

        print("Migrating attachments...")
        attach_stats = migrate_attachments(
            db,
            backend,
            dry_run=args.dry_run,
            batch_size=args.batch_size,
            verify=args.verify,
        )
        print(attach_stats.summary("attachments"))

        if args.include_skills:
            print("Migrating skill/plugin binaries...")
            skill_stats = migrate_skill_binaries(
                db, dry_run=args.dry_run, batch_size=args.batch_size
            )
            print(skill_stats.summary("skill_binaries"))
            total_failed = attach_stats.failed + skill_stats.failed
        else:
            total_failed = attach_stats.failed

        print("Done.")
        return 1 if total_failed else 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
