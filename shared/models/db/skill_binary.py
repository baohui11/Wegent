# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Skill binary storage model for Claude Code Skills ZIP packages.
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.dialects.mysql import MEDIUMBLOB

from .base import Base

SkillBinaryDataType = LargeBinary().with_variant(MEDIUMBLOB, "mysql")


class SkillBinary(Base):
    """Skill binary data storage for ZIP packages.

    Storage location is selected at write time:

    - When the configured attachment storage backend is ``mysql`` (the
      default), the ZIP bytes are stored in ``binary_data`` and
      ``storage_key`` stays NULL.
    - When the backend is ``s3``/``minio``, the ZIP is uploaded to object
      storage and ``storage_key`` holds the object key. ``binary_data`` is
      left NULL so MySQL is not bloated by large blobs.

    ``binary_data`` is nullable to support the S3 path; the column is kept
    on the table to remain forward-compatible with the upstream Wegent
    schema and avoid breaking ``MySQLStorageBackend`` behaviour.
    """

    __tablename__ = "skill_binaries"

    id = Column(Integer, primary_key=True, index=True)
    kind_id = Column(
        Integer, ForeignKey("kinds.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    # ZIP package binary data (only populated when using the MySQL backend).
    binary_data = Column(SkillBinaryDataType, nullable=True)
    # Object storage key (populated when using the S3/MinIO backend).
    storage_key = Column(String(512), nullable=True)
    file_size = Column(Integer, nullable=False)  # File size in bytes
    file_hash = Column(String(64), nullable=False)  # SHA256 hash
    created_at = Column(DateTime, default=datetime.now)

    __table_args__ = (
        {
            "sqlite_autoincrement": True,
            "mysql_engine": "InnoDB",
            "mysql_charset": "utf8mb4",
            "mysql_collate": "utf8mb4_unicode_ci",
        },
    )
