# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""add user real_name and department_name

Revision ID: d5e6f7a8b0c1
Revises: c4d5e6f7a8b9
Create Date: 2026-06-09
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b0c1"
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("real_name", sa.String(length=100), nullable=True))
    op.add_column(
        "users", sa.Column("department_name", sa.String(length=200), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "department_name")
    op.drop_column("users", "real_name")
