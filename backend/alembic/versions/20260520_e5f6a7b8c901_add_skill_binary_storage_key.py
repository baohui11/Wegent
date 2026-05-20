# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""add storage_key column to skill_binaries and relax binary_data NOT NULL

Revision ID: e5f6a7b8c901
Revises: d4e5f6a7b810
Create Date: 2026-05-20

Phase 1 of the S3 storage migration: allow skill ZIP packages to live in
S3-compatible object storage instead of MySQL ``LONGBLOB``.

- Adds a nullable ``storage_key`` column that points at the S3 object key.
- Relaxes ``binary_data`` to NULL so writes can omit the blob when using
  the S3 backend. Existing rows keep their data; the MySQL backend keeps
  writing to ``binary_data`` as before.
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "e5f6a7b8c901"
down_revision = "d4e5f6a7b810"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skill_binaries",
        sa.Column("storage_key", sa.String(length=512), nullable=True),
    )
    # Some dialects (e.g. SQLite) cannot alter the nullability of a column
    # in-place. Use a try/except so the migration works for both MySQL and
    # SQLite-backed test environments without requiring batch operations
    # for every table.
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.alter_column(
            "skill_binaries",
            "binary_data",
            existing_type=sa.LargeBinary(),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        # Backfill any NULLs before re-enforcing NOT NULL so the downgrade
        # never blows up on existing S3-only rows. Empty bytes is the
        # historical sentinel used elsewhere in the codebase.
        op.execute(
            "UPDATE skill_binaries SET binary_data = '' WHERE binary_data IS NULL"
        )
        op.alter_column(
            "skill_binaries",
            "binary_data",
            existing_type=sa.LargeBinary(),
            nullable=False,
        )
    op.drop_column("skill_binaries", "storage_key")
