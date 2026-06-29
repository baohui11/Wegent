# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for WeComUserResolver."""

from unittest.mock import MagicMock

import pytest

from app.services.channels.wecom.user_resolver import WeComUserResolver


@pytest.mark.asyncio
async def test_select_user_mode_returns_target_user():
    db = MagicMock()
    target = MagicMock(id=42)
    db.query.return_value.filter.return_value.first.return_value = target

    resolver = WeComUserResolver(
        db, user_mapping_mode="select_user", user_mapping_config={"target_user_id": 42}
    )
    user = await resolver.resolve_user(userid="wc_user_1", name="Alice")
    assert user is target


@pytest.mark.asyncio
async def test_select_user_mode_without_target_returns_none():
    db = MagicMock()
    resolver = WeComUserResolver(
        db, user_mapping_mode="select_user", user_mapping_config=None
    )
    user = await resolver.resolve_user(userid="wc_user_1", name="Alice")
    assert user is None
