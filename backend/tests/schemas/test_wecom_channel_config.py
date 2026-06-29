import pytest
from pydantic import ValidationError

from app.schemas.im_channel import WeChatChannelConfig


def test_wecom_config_minimal_valid():
    cfg = WeChatChannelConfig(bot_id="bot123", connection_secret="sek")
    assert cfg.bot_id == "bot123"
    assert cfg.connection_secret == "sek"
    assert cfg.user_mapping_mode == "select_user"
    assert cfg.user_mapping_config is None


def test_wecom_config_requires_bot_id_and_secret():
    with pytest.raises(ValidationError):
        WeChatChannelConfig(bot_id="only_bot")  # missing connection_secret


def test_wecom_config_select_user_mapping():
    cfg = WeChatChannelConfig(
        bot_id="b",
        connection_secret="s",
        user_mapping_mode="select_user",
        user_mapping_config={"target_user_id": 42},
    )
    assert cfg.user_mapping_config["target_user_id"] == 42


def test_wecom_config_with_push_credentials():
    cfg = WeChatChannelConfig(
        bot_id="b",
        connection_secret="s",
        corp_id="ww123",
        corp_secret="appsecret",
        agent_id="1000002",
    )
    assert cfg.corp_id == "ww123"
    assert cfg.corp_secret == "appsecret"
    assert cfg.agent_id == "1000002"


def test_wecom_config_push_credentials_optional():
    # A chat-only channel without push credentials must still validate.
    cfg = WeChatChannelConfig(bot_id="b", connection_secret="s")
    assert cfg.corp_id is None
    assert cfg.corp_secret is None
    assert cfg.agent_id is None
