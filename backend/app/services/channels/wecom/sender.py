# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""WeCom self-built app active-push sender (message/send)."""

import logging
from typing import Any, Dict, Optional

import aiohttp

from app.core.cache import cache_manager

logger = logging.getLogger(__name__)


class WeComSendError(Exception):
    """Raised when a WeCom API call fails in a non-recoverable way."""


class WeComAppSender:
    """Sends application messages via a WeCom self-built app.

    access_token is cached in Redis (shared across pods) with a single-point
    refresh; the cache key includes agent_id because one corp may run several
    apps with distinct tokens.
    """

    BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin"
    TOKEN_TTL = 7000  # under the 7200s server expiry

    def __init__(self, corp_id: str, corp_secret: str, agent_id: str):
        self._corp_id = corp_id
        self._corp_secret = corp_secret
        self._agent_id = agent_id

    def _token_key(self) -> str:
        return f"wecom:access_token:{self._corp_id}:{self._agent_id}"

    async def _http_get_json(self, url: str, params: Dict[str, Any]) -> Dict[str, Any]:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as resp:
                return await resp.json()

    async def _http_post_json(
        self, url: str, params: Dict[str, Any], json_body: Dict[str, Any]
    ) -> Dict[str, Any]:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, params=params, json=json_body) as resp:
                return await resp.json()

    async def _get_access_token(self, force_refresh: bool = False) -> str:
        key = self._token_key()
        if not force_refresh:
            cached = await cache_manager.get(key)
            if cached:
                return cached
        data = await self._http_get_json(
            f"{self.BASE_URL}/gettoken",
            {"corpid": self._corp_id, "corpsecret": self._corp_secret},
        )
        if data.get("errcode") not in (0, None) or not data.get("access_token"):
            raise WeComSendError(
                f"gettoken failed: errcode={data.get('errcode')} "
                f"errmsg={data.get('errmsg')}"
            )
        token = data["access_token"]
        await cache_manager.set(key, token, expire=self.TOKEN_TTL)
        return token

    async def send_markdown(
        self, touser: str, title: str, content: str
    ) -> Dict[str, Any]:
        """Send a markdown application message to a single user."""
        body = {
            "touser": touser,
            "agentid": int(self._agent_id),
            "msgtype": "markdown",
            "markdown": {"content": f"**{title}**\n{content}"},
        }
        return await self._post_message(body)

    async def _post_message(
        self, body: Dict[str, Any], _retried: bool = False
    ) -> Dict[str, Any]:
        token = await self._get_access_token()
        data = await self._http_post_json(
            f"{self.BASE_URL}/message/send", {"access_token": token}, body
        )
        errcode = data.get("errcode")
        # 40014 invalid token / 42001 expired token: drop cache and retry once.
        if errcode in (40014, 42001) and not _retried:
            await cache_manager.delete(self._token_key())
            await self._get_access_token(force_refresh=True)
            return await self._post_message(body, _retried=True)
        if errcode not in (0, None):
            logger.warning(
                "[WeComAppSender] message/send errcode=%s errmsg=%s",
                errcode,
                data.get("errmsg"),
            )
        elif data.get("invaliduser"):
            logger.warning(
                "[WeComAppSender] invaliduser=%s (outside app visibility scope)",
                data.get("invaliduser"),
            )
        return data


def resolve_touser(
    db, user_id: int, mapping_mode: str, binding: Optional[Any]
) -> Optional[str]:
    """Resolve a Wegent user to a WeCom userid for active push.

    staff_id mode: the Wegent username IS the WeCom userid (direct, no prior
    interaction required). Other modes fall back to the inbound binding.
    """
    if mapping_mode == "staff_id":
        from app.models.user import User

        user = db.query(User).filter(User.id == user_id).first()
        return user.user_name if user else None
    return binding.sender_id if binding else None
