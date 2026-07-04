# SPDX-License-Identifier: Apache-2.0
"""Lightweight ledger for bid-workbench projects. Substantive artifacts live in
the per-project workspace blackboard, not here."""

from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Index, Integer, String

from app.db.base import Base


class BidProject(Base):
    __tablename__ = "bid_projects"
    __table_args__ = (
        Index("ix_bid_projects_user_id", "user_id"),
        {
            "mysql_engine": "InnoDB",
            "mysql_charset": "utf8mb4",
            "sqlite_autoincrement": True,
        },
    )
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    workspace_ref = Column(String(128), nullable=False)
    # Authoritative per-phase cursor, e.g. {"phase1": "done"}.
    phase_status = Column(JSON, nullable=False, default=dict)
    current_phase = Column(Integer, nullable=False, default=1)
    max_phase_reached = Column(Integer, nullable=False, default=1)
    status = Column(String(32), nullable=False, default="created")
    # User-selected Model CRD name for this project's LLM calls; empty -> fall
    # back to the global BID_TENDER_MODEL_NAME.
    model_name = Column(String(128), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
