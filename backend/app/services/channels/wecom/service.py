# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""WeCom smart-bot long-connection channel provider."""

import asyncio
import logging
from typing import Any, Dict, Optional

import aiohttp

from app.core.cache import cache_manager
from app.services.channels.base import BaseChannelProvider, ChannelLike
from app.services.channels.wecom import protocol as p
from app.services.channels.wecom.handler import WeComChannelHandler
from app.services.channels.wecom.reply_bus import ReplySubscription, subscribe_replies

logger = logging.getLogger(__name__)

WECOM_WS_URL = "wss://openws.work.weixin.qq.com"
WECOM_MSG_DEDUP_PREFIX = "wecom:msg_dedup:"
WECOM_MSG_DEDUP_TTL = 300
HEARTBEAT_INTERVAL = 30
_MAX_BACKOFF = 60


def _get_channel_default_team_id(channel_id: int) -> Optional[int]:
    """Look up the default team ID for a channel from the database."""
    from app.db.session import SessionLocal
    from app.models.kind import Kind

    db = SessionLocal()
    try:
        ch = (
            db.query(Kind)
            .filter(Kind.id == channel_id, Kind.kind == "Messager", Kind.user_id == 0)
            .first()
        )
        return (ch.json.get("spec", {}).get("defaultTeamId", 0)) if ch else None
    finally:
        db.close()


def _get_channel_default_model_name(channel_id: int) -> Optional[str]:
    """Look up the default model name for a channel from the database.

    Returns None if the channel is not found or the model name is empty.
    """
    from app.db.session import SessionLocal
    from app.models.kind import Kind

    db = SessionLocal()
    try:
        ch = (
            db.query(Kind)
            .filter(Kind.id == channel_id, Kind.kind == "Messager", Kind.user_id == 0)
            .first()
        )
        if not ch:
            return None
        model_name = ch.json.get("spec", {}).get("defaultModelName", "")
        return model_name if model_name else None
    finally:
        db.close()


def _get_channel_user_mapping_config(channel_id: int) -> Dict[str, Any]:
    """Look up the user-mapping config for a channel from the database."""
    from app.db.session import SessionLocal
    from app.models.kind import Kind

    db = SessionLocal()
    try:
        ch = (
            db.query(Kind)
            .filter(Kind.id == channel_id, Kind.kind == "Messager", Kind.user_id == 0)
            .first()
        )
        if not ch:
            return {"mode": "select_user", "config": None}
        config = ch.json.get("spec", {}).get("config", {})
        return {
            "mode": config.get("user_mapping_mode", "select_user"),
            "config": config.get("user_mapping_config"),
        }
    finally:
        db.close()


class WeComChannelProvider(BaseChannelProvider):
    """Owns the single WeCom WebSocket connection for a bot.

    Lifecycle: start() spawns _connect_loop as a background asyncio task and
    returns True immediately.  _connect_loop handles auth, heartbeat, reply-bus
    subscription, and reconnection with capped exponential backoff.

    PHASE 1 SINGLE-REPLICA CONSTRAINT
    -----------------------------------
    WeCom's smart-bot long-connection protocol allows exactly ONE active
    WebSocket connection per bot at a time.  Opening a second connection from
    another pod causes WeCom to kick the existing connection (the old pod loses
    its WS), and the reply bus key ``wecom:reply:{bot_id}`` is consumed by every
    pod that has subscribed — so both pods would receive incoming frames AND
    attempt to write outbound reply frames, resulting in:

    * connection contention — WeCom continuously kicks whichever pod was
      connected last, making the link unstable;
    * duplicated reply writes — the reply bus broadcasts to all subscribers, so
      every pod sends the same reply frame to WeCom, producing duplicate
      messages for the end user.

    **Phase 1 therefore supports single-replica deployments only.**  Running
    multiple backend replicas with WeCom channels enabled will cause the above
    symptoms.  A Redis lease-based single-owner election (one pod per bot_id
    holds the WS; others stand by) is deferred to Phase 2.
    """

    def __init__(self, channel: ChannelLike):
        super().__init__(channel)
        self._ws = None
        self._connect_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._reply_sub: Optional[ReplySubscription] = None
        self._stopping = False
        self._send_lock = asyncio.Lock()
        channel_id = self.channel_id
        self._handler = WeComChannelHandler(
            channel_id=channel_id,
            bot_id=self.bot_id,
            get_default_team_id=lambda: _get_channel_default_team_id(channel_id),
            get_default_model_name=lambda: _get_channel_default_model_name(channel_id),
            get_user_mapping_config=lambda: _get_channel_user_mapping_config(
                channel_id
            ),
        )

    @property
    def bot_id(self) -> Optional[str]:
        """WeCom bot ID from channel config."""
        return self.config.get("bot_id")

    @property
    def connection_secret(self) -> Optional[str]:
        """WeCom connection secret from channel config."""
        return self.config.get("connection_secret")

    def _is_configured(self) -> bool:
        """Return True when both bot_id and connection_secret are non-empty."""
        return bool(self.bot_id and self.connection_secret)

    async def start(self) -> bool:
        """Validate config, spawn _connect_loop, and return True immediately."""
        if not self._is_configured():
            self._set_error("WeCom not configured: missing bot_id or connection_secret")
            return False
        if self._is_running:
            return True
        # Phase 1: single-replica only.  Multiple replicas cause WeCom to kick
        # competing connections and the reply bus to deliver duplicate frames.
        logger.warning(
            "[WeCom] Phase 1 single-replica mode: channel %s (bot_id=%s). "
            "Running multiple backend replicas with WeCom enabled will cause "
            "WebSocket connection contention and duplicated replies.",
            self.channel_name,
            self.bot_id,
        )
        self._stopping = False
        self._connect_task = asyncio.create_task(self._connect_loop())
        self._set_running(True)
        logger.info(
            "[WeCom] Channel %s (id=%d) started", self.channel_name, self.channel_id
        )
        return True

    async def stop(self) -> None:
        """Gracefully shut down the WebSocket connection and background tasks."""
        self._stopping = True
        self._set_running(False)
        # Cancel the heartbeat first so it stops writing to _ws.
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
        if self._reply_sub:
            await self._reply_sub.close()
            self._reply_sub = None
        if self._ws:
            await self._ws.close()
            self._ws = None
        # Cancel and await the connect task so its finally-block finishes
        # before stop() returns, preventing it from clobbering a subsequent
        # start() that may create fresh _ws / _reply_sub / _heartbeat_task.
        if self._connect_task:
            self._connect_task.cancel()
            try:
                await self._connect_task
            except asyncio.CancelledError:
                pass
            self._connect_task = None

    async def _ws_send(self, frame: p.WeComFrame) -> None:
        """Encode and send a frame, serialising all writes behind a lock."""
        async with self._send_lock:
            if self._ws is not None and not self._ws.closed:
                await self._ws.send_str(p.encode_frame(frame))

    async def _connect_loop(self) -> None:
        """Connect, subscribe, receive, and reconnect with exponential backoff.

        Uses aiohttp rather than the ``websockets`` library: WeCom's ``openws``
        server sends frames that strict ``websockets`` rejects as "incorrect
        masking" (dropping the connection after ~25s); aiohttp tolerates them.
        """
        backoff = 1
        while not self._stopping:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.ws_connect(WECOM_WS_URL, heartbeat=None) as ws:
                        self._ws = ws
                        await self._ws_send(
                            p.build_subscribe(self.bot_id, self.connection_secret)
                        )
                        self._reply_sub = await subscribe_replies(
                            self.bot_id, self._on_reply_frame
                        )
                        self._heartbeat_task = asyncio.create_task(
                            self._heartbeat_loop()
                        )
                        backoff = 1
                        await self._recv_loop(ws)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._set_error(f"WeCom connection error: {e}")
            finally:
                self._ws = None
                if self._reply_sub:
                    await self._reply_sub.close()
                    self._reply_sub = None
                if self._heartbeat_task:
                    self._heartbeat_task.cancel()
                    self._heartbeat_task = None
            if self._stopping:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF)

    async def _recv_loop(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        """Read frames from the WebSocket and dispatch them."""
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    frame = p.decode_frame(msg.data)
                except Exception:
                    logger.exception("[WeCom] Failed to decode frame")
                    continue
                if frame.command == p.CMD_MSG_CALLBACK:
                    await self._handle_frame(frame)
                elif frame.errcode not in (None, 0):
                    # Server ack/response frames carry no cmd; a non-zero
                    # errcode signals subscribe/reply failure or rate limiting.
                    logger.warning(
                        "[WeCom] server ack errcode=%s errmsg=%s req_id=%s",
                        frame.errcode,
                        frame.errmsg,
                        frame.req_id,
                    )
                # Successful acks (errcode 0) and event frames are ignored.
            elif msg.type in (
                aiohttp.WSMsgType.CLOSED,
                aiohttp.WSMsgType.CLOSING,
                aiohttp.WSMsgType.ERROR,
            ):
                break

    async def _heartbeat_loop(self) -> None:
        """Send a ping frame every HEARTBEAT_INTERVAL seconds."""
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                await self._ws_send(p.build_ping())
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[WeCom] Heartbeat error")

    async def _handle_frame(self, frame: p.WeComFrame) -> None:
        """Dedup by msgid (Redis setnx), then delegate to the handler.

        ``body.msgid`` is WeCom's stable per-message id and is the documented
        dedup key; ``headers.req_id`` is a per-delivery id used to address the
        reply. Fall back to req_id only if msgid is absent.
        """
        dedup_id = frame.payload.get("msgid") or frame.req_id
        if dedup_id:
            is_new = await cache_manager.setnx(
                f"{WECOM_MSG_DEDUP_PREFIX}{dedup_id}",
                "1",
                expire=WECOM_MSG_DEDUP_TTL,
            )
            if not is_new:
                logger.warning("[WeCom] Duplicate message skipped: msgid=%s", dedup_id)
                return
        await self._handler.handle_message(frame)

    async def _on_reply_frame(self, frame: p.WeComFrame) -> None:
        """Write a reply frame (from the Redis bus) to the live WS."""
        try:
            await self._ws_send(frame)
        except Exception:
            logger.exception("[WeCom] Failed to write reply frame to WS")
