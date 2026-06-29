from unittest.mock import AsyncMock, patch

import pytest

from app.services.channels.wecom.sender import WeComAppSender, WeComSendError


def _sender():
    return WeComAppSender(corp_id="ww1", corp_secret="sek", agent_id="1000002")


@pytest.mark.asyncio
async def test_get_token_cache_hit_skips_http():
    s = _sender()
    with (
        patch(
            "app.services.channels.wecom.sender.cache_manager.get",
            AsyncMock(return_value="CACHED"),
        ),
        patch.object(s, "_http_get_json", AsyncMock()) as http,
    ):
        token = await s._get_access_token()
    assert token == "CACHED"
    http.assert_not_awaited()


@pytest.mark.asyncio
async def test_get_token_cache_miss_fetches_and_caches():
    s = _sender()
    with (
        patch(
            "app.services.channels.wecom.sender.cache_manager.get",
            AsyncMock(return_value=None),
        ),
        patch(
            "app.services.channels.wecom.sender.cache_manager.set", AsyncMock()
        ) as cset,
        patch.object(
            s,
            "_http_get_json",
            AsyncMock(return_value={"errcode": 0, "access_token": "NEW"}),
        ),
    ):
        token = await s._get_access_token()
    assert token == "NEW"
    cset.assert_awaited_once()
    assert cset.await_args.args[0] == "wecom:access_token:ww1:1000002"


@pytest.mark.asyncio
async def test_get_token_raises_on_errcode():
    s = _sender()
    with (
        patch(
            "app.services.channels.wecom.sender.cache_manager.get",
            AsyncMock(return_value=None),
        ),
        patch.object(
            s,
            "_http_get_json",
            AsyncMock(return_value={"errcode": 40001, "errmsg": "bad secret"}),
        ),
    ):
        with pytest.raises(WeComSendError):
            await s._get_access_token()


@pytest.mark.asyncio
async def test_send_markdown_builds_payload():
    s = _sender()
    with (
        patch.object(s, "_get_access_token", AsyncMock(return_value="T")),
        patch.object(
            s, "_http_post_json", AsyncMock(return_value={"errcode": 0})
        ) as post,
    ):
        await s.send_markdown(touser="LiWeiXia", title="Done", content="result")
    url, params, body = (
        post.await_args.args[0],
        post.await_args.args[1],
        post.await_args.args[2],
    )
    assert url.endswith("/message/send")
    assert params == {"access_token": "T"}
    assert body["touser"] == "LiWeiXia"
    assert body["agentid"] == 1000002
    assert body["msgtype"] == "markdown"
    assert "Done" in body["markdown"]["content"]
    assert "result" in body["markdown"]["content"]


@pytest.mark.asyncio
async def test_send_markdown_retries_once_on_expired_token():
    s = _sender()
    responses = [{"errcode": 42001, "errmsg": "expired"}, {"errcode": 0}]
    with (
        patch.object(s, "_get_access_token", AsyncMock(return_value="T")),
        patch(
            "app.services.channels.wecom.sender.cache_manager.delete", AsyncMock()
        ) as cdel,
        patch.object(s, "_http_post_json", AsyncMock(side_effect=responses)) as post,
    ):
        result = await s.send_markdown(touser="u", title="t", content="c")
    assert result == {"errcode": 0}
    assert post.await_count == 2
    cdel.assert_awaited_once()
