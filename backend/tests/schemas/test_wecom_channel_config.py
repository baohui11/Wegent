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
