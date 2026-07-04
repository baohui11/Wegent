# SPDX-License-Identifier: Apache-2.0
"""add bid_llm_calls.label column

Revision ID: bidllmlabel0704
Revises: g3b4c5d6e7f8
Create Date: 2026-07-04
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "bidllmlabel0704"
down_revision: Union[str, Sequence[str], None] = "g3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bid_llm_calls",
        sa.Column("label", sa.String(length=128), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("bid_llm_calls", "label")
