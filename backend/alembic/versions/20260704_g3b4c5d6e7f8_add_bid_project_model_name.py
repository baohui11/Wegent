# SPDX-License-Identifier: Apache-2.0
"""add bid_projects.model_name column

Revision ID: g3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-07-04
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "g3b4c5d6e7f8"
down_revision: Union[str, Sequence[str], None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bid_projects",
        sa.Column(
            "model_name",
            sa.String(length=128),
            nullable=False,
            server_default="",
        ),
    )


def downgrade() -> None:
    op.drop_column("bid_projects", "model_name")
