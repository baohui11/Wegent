from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.subscription.notification_dispatcher import (
    SubscriptionNotificationDispatcher,
)


def _wecom_channel():
    ch = MagicMock()
    ch.json = {
        "spec": {
            "channelType": "wecom",
            "config": {
                "user_mapping_mode": "staff_id",
                "corp_id": "ww1",
                "corp_secret": "enc",
                "agent_id": "1000002",
            },
        }
    }
    return ch


@pytest.mark.asyncio
async def test_send_wecom_notification_staff_id_no_binding():
    d = SubscriptionNotificationDispatcher()
    db = MagicMock()

    with (
        patch(
            "app.services.subscription.notification_dispatcher.decrypt_sensitive_data",
            return_value="appsecret",
        ),
        patch(
            "app.services.subscription.notification_dispatcher.resolve_touser",
            return_value="LiWeiXia",
        ),
        patch(
            "app.services.subscription.notification_dispatcher.WeComAppSender"
        ) as sender_cls,
    ):
        sender_cls.return_value.send_markdown = AsyncMock(return_value={"errcode": 0})
        await d._send_wecom_notification(
            db=db,
            channel=_wecom_channel(),
            binding=None,  # staff_id mode does not need a binding
            user_id=42,
            message="result text",
            subscription_id=1,
            execution_id=2,
            subscription_display_name="My Sub",
        )

    sender_cls.return_value.send_markdown.assert_awaited_once()
    kwargs = sender_cls.return_value.send_markdown.await_args.kwargs
    assert kwargs["touser"] == "LiWeiXia"
    assert kwargs["title"] == "My Sub"


@pytest.mark.asyncio
async def test_send_wecom_notification_skips_when_no_push_creds():
    d = SubscriptionNotificationDispatcher()
    ch = MagicMock()
    ch.json = {
        "spec": {"channelType": "wecom", "config": {"user_mapping_mode": "staff_id"}}
    }

    with patch(
        "app.services.subscription.notification_dispatcher.WeComAppSender"
    ) as sender_cls:
        await d._send_wecom_notification(
            db=MagicMock(),
            channel=ch,
            binding=None,
            user_id=42,
            message="m",
            subscription_id=1,
            execution_id=2,
            subscription_display_name="S",
        )
    sender_cls.assert_not_called()  # chat-only channel: no push attempted


@pytest.mark.asyncio
async def test_send_wecom_notification_skips_when_touser_unresolved():
    d = SubscriptionNotificationDispatcher()

    with (
        patch(
            "app.services.subscription.notification_dispatcher.decrypt_sensitive_data",
            return_value="appsecret",
        ),
        patch(
            "app.services.subscription.notification_dispatcher.resolve_touser",
            return_value=None,  # e.g. select_user mode with no binding
        ),
        patch(
            "app.services.subscription.notification_dispatcher.WeComAppSender"
        ) as sender_cls,
    ):
        await d._send_wecom_notification(
            db=MagicMock(),
            channel=_wecom_channel(),
            binding=None,
            user_id=42,
            message="m",
            subscription_id=1,
            execution_id=2,
            subscription_display_name="S",
        )
    sender_cls.return_value.send_markdown.assert_not_called()
