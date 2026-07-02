# SPDX-License-Identifier: Apache-2.0
"""add bid_projects table

Revision ID: f1a2b3c4d5e6
Revises: 9204f64530c3
Create Date: 2026-07-02

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "9204f64530c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bid_projects",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("workspace_ref", sa.String(length=128), nullable=False),
        sa.Column("phase_status", sa.JSON(), nullable=False),
        sa.Column("current_phase", sa.Integer(), nullable=False),
        sa.Column("max_phase_reached", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        sqlite_autoincrement=True,
    )
    op.create_index("ix_bid_projects_user_id", "bid_projects", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_bid_projects_user_id", table_name="bid_projects")
    op.drop_table("bid_projects")
