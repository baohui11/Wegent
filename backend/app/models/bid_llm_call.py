# SPDX-License-Identifier: Apache-2.0
"""Full audit log of every bid LLM (specialist) call. Substantive artifacts
live in the workspace; this table exists for usage accounting + observability
(the calls bypass the Task system deliberately, so this is the record of them)."""

from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, String, Text

from app.db.base import Base


class BidLlmCall(Base):
    __tablename__ = "bid_llm_calls"
    __table_args__ = (
        Index("ix_bid_llm_calls_project_id", "project_id"),
        {
            "mysql_engine": "InnoDB",
            "mysql_charset": "utf8mb4",
            "sqlite_autoincrement": True,
        },
    )
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    specialist = Column(
        String(64), nullable=False
    )  # tender_sleuth / ghostwriter / fact_checker
    model = Column(String(128), nullable=False, default="")
    request = Column(Text)  # full instructions + input
    response = Column(Text)  # full extracted text
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    duration_ms = Column(Integer, nullable=False, default=0)
    status = Column(String(16), nullable=False, default="ok")  # ok / error
    error = Column(Text)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
