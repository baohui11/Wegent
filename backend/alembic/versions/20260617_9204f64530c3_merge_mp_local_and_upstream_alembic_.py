"""merge mp_local and upstream alembic heads

Revision ID: 9204f64530c3
Revises: d5e6f7a8b0c1, d5e6f7a8b9c0
Create Date: 2026-06-17 15:09:06.291942+08:00

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9204f64530c3"
down_revision: Union[str, Sequence[str], None] = ("d5e6f7a8b0c1", "d5e6f7a8b9c0")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
