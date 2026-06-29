# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Resolve WeCom users to Wegent users."""

import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.user import User

logger = logging.getLogger(__name__)


class WeComUserResolver:
    """Map a WeCom userid to a Wegent User per the channel's mapping mode.

    Supported modes:
    - select_user (default): always return a single configured Wegent user (target_user_id).
    - email: look up the user whose email matches ``{userid}@{email_domain}``.
    - staff_id: treat the WeCom userid as the Wegent username.
    """

    def __init__(
        self,
        db: Session,
        user_mapping_mode: str = "select_user",
        user_mapping_config: Optional[Dict[str, Any]] = None,
    ):
        self._db = db
        self._mode = user_mapping_mode
        self._config = user_mapping_config or {}

    async def resolve_user(
        self, userid: str, name: Optional[str] = None
    ) -> Optional[User]:
        """Resolve a WeCom userid to a Wegent User.

        Args:
            userid: WeCom user identifier.
            name: Display name (used for logging only).

        Returns:
            Matching User, or None if resolution fails.
        """
        if self._mode == "select_user":
            target_user_id = self._config.get("target_user_id")
            if not target_user_id:
                logger.warning(
                    "[WeComUserResolver] select_user mode but no target_user_id configured"
                )
                return None
            return (
                self._db.query(User)
                .filter(User.id == target_user_id, User.is_active == True)  # noqa: E712
                .first()
            )

        if self._mode == "email":
            email_domain = self._config.get("email_domain")
            lookup = f"{userid}@{email_domain}" if email_domain else userid
            return (
                self._db.query(User)
                .filter(User.email == lookup, User.is_active == True)  # noqa: E712
                .first()
            )

        # staff_id mode: treat WeCom userid as Wegent username
        return (
            self._db.query(User)
            .filter(User.user_name == userid, User.is_active == True)  # noqa: E712
            .first()
        )
