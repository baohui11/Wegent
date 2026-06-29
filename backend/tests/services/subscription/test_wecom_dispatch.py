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


@pytest.mark.asyncio
async def test_send_messager_notifications_wecom_no_binding_calls_wecom_path():
    """Dispatch-gate: wecom channel without a user binding still reaches _send_wecom_notification.

    This locks Spec §6 — the binding gate is bypassed for wecom, so the active-push
    path is always scheduled even when user_bindings is empty.
    """
    d = SubscriptionNotificationDispatcher()

    # Build a wecom channel Kind mock
    channel = _wecom_channel()
    channel.id = 99

    # Subscription mock (needed to resolve subscription_owner_id)
    subscription_mock = MagicMock()
    subscription_mock.user_id = 7

    # db.query(...).filter(...).first() is called twice:
    #   1st call → subscription (to get subscription_owner_id)
    #   2nd call → channel (inside the channel_ids loop)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = [
        subscription_mock,
        channel,
    ]

    with (
        patch(
            "app.services.subscription.notification_dispatcher"
            ".subscription_notification_service.get_user_im_bindings",
            return_value={},  # no bindings for any channel
        ),
        patch.object(
            d,
            "_format_notification_message",
            return_value="formatted",
        ),
        patch.object(
            d,
            "_convert_attachment_links",
            return_value="formatted",
        ),
        patch.object(
            d,
            "_send_wecom_notification",
            new_callable=AsyncMock,
        ) as mock_wecom,
    ):
        await d._send_messager_notifications(
            db=db,
            user_id=7,
            channel_ids=[99],
            subscription_id=5,
            execution_id=3,
            subscription_display_name="Gate Test Sub",
            result_summary="ok",
            status="success",
        )

    # Even with no binding, the wecom path must have been scheduled/awaited
    mock_wecom.assert_awaited_once()
    call_kwargs = mock_wecom.await_args.kwargs
    assert call_kwargs["channel"] is channel
    assert call_kwargs["binding"] is None  # no binding was provided
