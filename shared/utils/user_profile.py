# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Helpers for serializing user profile fields used in UI display."""

from typing import Any, Dict, Optional


def user_profile_fields(user: Any) -> Dict[str, Optional[str]]:
    """Extract user profile fields for API responses and display."""
    if user is None:
        return {
            "user_name": None,
            "real_name": None,
            "department_name": None,
        }
    return {
        "user_name": getattr(user, "user_name", None),
        "real_name": getattr(user, "real_name", None),
        "department_name": getattr(user, "department_name", None),
    }


def user_display_primary(user: Any, *, fallback: str = "") -> str:
    """Primary display label: real_name, then user_name, then fallback."""
    if user is None:
        return fallback
    real_name = getattr(user, "real_name", None)
    if isinstance(real_name, str) and real_name.strip():
        return real_name.strip()
    user_name = getattr(user, "user_name", None)
    if isinstance(user_name, str) and user_name.strip():
        return user_name.strip()
    return fallback
