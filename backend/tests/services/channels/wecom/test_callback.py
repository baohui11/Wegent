import pytest

from app.services.channels.callback import ChannelType, get_callback_registry
from app.services.channels.wecom.callback import (
    WeComCallbackInfo,
    WeComCallbackService,
    wecom_callback_service,
)
from app.services.channels.wecom.emitter import WeComStreamEmitter


def test_callback_info_round_trip():
    info = WeComCallbackInfo(
        channel_id=7,
        conversation_id="conv1",
        bot_id="botX",
        req_id="r1",
        stream_id="s1",
    )
    data = info.to_dict()
    back = WeComCallbackInfo.from_dict(data)
    assert back.channel_id == 7
    assert back.bot_id == "botX"
    assert back.req_id == "r1"
    assert back.stream_id == "s1"
    assert back.channel_type == ChannelType.WECHAT


def test_service_registered_in_registry():
    assert (
        get_callback_registry().get_service(ChannelType.WECHAT)
        is wecom_callback_service
    )


@pytest.mark.asyncio
async def test_create_emitter_builds_wecom_emitter():
    info = WeComCallbackInfo(
        channel_id=7, conversation_id="c", bot_id="b", req_id="r", stream_id="s"
    )
    emitter = await wecom_callback_service._create_emitter(
        task_id=1, subtask_id=1, callback_info=info
    )
    assert isinstance(emitter, WeComStreamEmitter)
