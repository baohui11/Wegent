from unittest.mock import MagicMock

from app.services.channels.callback import ChannelType
from app.services.channels.manager import ChannelManager
from app.services.channels.wecom.service import WeComChannelProvider


def _channel():
    ch = MagicMock()
    ch.id = 11
    ch.name = "wc"
    ch.channel_type = "wechat"
    ch.is_enabled = True
    ch.config = {"bot_id": "b", "connection_secret": "s"}
    ch.default_team_id = 1
    ch.default_model_name = ""
    return ch


def test_wechat_is_supported():
    ChannelManager.reset_instance()
    mgr = ChannelManager()
    assert "wechat" in mgr.get_supported_channel_types()


def test_factory_builds_wecom_provider():
    ChannelManager.reset_instance()
    mgr = ChannelManager()
    provider = mgr._create_provider(_channel())
    assert isinstance(provider, WeComChannelProvider)
