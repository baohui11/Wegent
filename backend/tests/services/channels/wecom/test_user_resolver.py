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


@pytest.mark.asyncio
async def test_email_mode_filters_is_active():
    """email mode must not resolve a deactivated user (is_active guard).

    Verified by checking that filter() receives exactly two conditions
    (email match + is_active guard) rather than just one.
    """
    db = MagicMock()
    # Simulate the DB returning None because the is_active filter excluded the user.
    db.query.return_value.filter.return_value.first.return_value = None

    resolver = WeComUserResolver(
        db,
        user_mapping_mode="email",
        user_mapping_config={"email_domain": "example.com"},
    )
    user = await resolver.resolve_user(userid="alice", name="Alice")
    assert user is None

    # filter() must be called with two positional conditions: email + is_active.
    filter_call_args = db.query.return_value.filter.call_args
    assert filter_call_args is not None
    assert (
        len(filter_call_args.args) == 2
    ), "email mode filter must include both email and is_active conditions"


@pytest.mark.asyncio
async def test_staff_id_mode_resolves_active_user():
    """staff_id mode resolves an active user by user_name.

    Verified by checking that filter() receives exactly two conditions
    (user_name match + is_active guard).
    """
    db = MagicMock()
    active_user = MagicMock(id=7, user_name="zhangsan")
    db.query.return_value.filter.return_value.first.return_value = active_user

    resolver = WeComUserResolver(db, user_mapping_mode="staff_id")
    user = await resolver.resolve_user(userid="zhangsan", name="Zhang San")
    assert user is active_user

    # filter() must be called with two positional conditions: user_name + is_active.
    filter_call_args = db.query.return_value.filter.call_args
    assert filter_call_args is not None
    assert (
        len(filter_call_args.args) == 2
    ), "staff_id mode filter must include both user_name and is_active conditions"


@pytest.mark.asyncio
async def test_staff_id_mode_returns_none_for_inactive_user():
    """staff_id mode returns None when the matched user is deactivated."""
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None

    resolver = WeComUserResolver(db, user_mapping_mode="staff_id")
    user = await resolver.resolve_user(userid="inactive_user")
    assert user is None
