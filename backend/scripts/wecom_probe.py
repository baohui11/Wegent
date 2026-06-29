# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""WeCom smart-bot long-connection PROBE — Phase 1 real-bot verification.

Purpose
-------
Phase 1 self-rolled the WeCom long-connection protocol (``protocol.py``) and
``handler.parse_message`` against the documented frame shapes. This probe
connects to a real WeCom smart bot, prints every raw frame verbatim, shows how
our codec/handler WOULD interpret it, and exercises the streaming reply path —
so we can diff assumptions vs reality and correct ``protocol.py`` / ``handler.py``.

Transport note: WeCom's ``openws`` server sends frames the strict ``websockets``
library rejects as "incorrect masking" (it drops the connection after ~25s).
``aiohttp`` tolerates them, so both this probe and the provider use ``aiohttp``.

Usage
-----
From the ``backend/`` directory::

    WECOM_BOT_ID=xxx WECOM_CONNECTION_SECRET=yyy uv run python scripts/wecom_probe.py

Then, in WeCom:
  1. Single chat: DM the bot, send "hello".
  2. Group chat: @-mention the bot, send "hello".
Optional flags:
  --truncate-test   also send a >20480-byte reply to confirm truncation behaviour
  --no-reply        only observe inbound frames, do not send streaming replies

What to capture (paste back the probe's stdout):
  [A] the AUTH-ACK frame printed right after "SENT subscribe"
  [B] one full RAW aibot_msg_callback frame for a SINGLE chat
  [C] one full RAW aibot_msg_callback frame for a GROUP chat (@-mention)
  [D] any ping/pong frames the server sends
  [E] whether the staged streaming reply rendered as a typewriter in WeCom,
      and (if --truncate-test) how the over-long reply rendered
  [F] roughly how long until the stream stops accepting updates (6 vs 10 min)

This is a diagnostic tool: it never writes to the app DB or Redis.
"""

import argparse
import asyncio
import json
import os
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

# Make the backend package importable when run as a standalone script.
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.services.channels.wecom import protocol as p  # noqa: E402

WECOM_WS_URL = "wss://openws.work.weixin.qq.com"


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]


def _banner(title: str) -> None:
    print(f"\n{'=' * 70}\n[{_ts()}] {title}\n{'=' * 70}", flush=True)


def _dump_raw(direction: str, raw: str) -> None:
    """Print a frame verbatim, pretty-printed if it is JSON."""
    print(f"\n[{_ts()}] {direction} RAW:", flush=True)
    try:
        print(json.dumps(json.loads(raw), ensure_ascii=False, indent=2), flush=True)
    except Exception:
        print(repr(raw), flush=True)


def _show_codec_view(raw: str) -> "p.WeComFrame | None":
    """Show how OUR codec decodes the frame, so mismatches are obvious."""
    try:
        frame = p.decode_frame(raw)
    except Exception as e:
        print(f"  !! our decode_frame() FAILED: {e}", flush=True)
        return None
    print(
        f"  -> our codec: command={frame.command!r} req_id={frame.req_id!r} "
        f"errcode={frame.errcode!r} payload_keys={sorted(frame.payload.keys())}",
        flush=True,
    )
    return frame


def _show_handler_view(frame: "p.WeComFrame") -> None:
    """Show what handler.parse_message WOULD extract — flag missing fields."""
    payload = frame.payload or {}
    msgtype = payload.get("msgtype")
    text = (payload.get("text") or {}).get("content")
    userid = (payload.get("from") or {}).get("userid")
    chattype = payload.get("chattype")
    chatid = payload.get("chatid")
    msgid = payload.get("msgid")
    print(
        "  -> handler would parse: "
        f"msgtype={msgtype!r} content={text!r} userid={userid!r} "
        f"chattype={chattype!r} chatid={chatid!r} msgid={msgid!r} "
        f"req_id={frame.req_id!r}",
        flush=True,
    )
    missing = [
        name
        for name, val in [
            ("msgtype", msgtype),
            ("text.content", text),
            ("from.userid", userid),
            ("chattype", chattype),
            ("headers.req_id", frame.req_id),
        ]
        if not val
    ]
    if missing:
        print(
            f"  !! MISSING under our assumed paths: {missing} "
            "— compare with the RAW frame above and correct protocol/handler.",
            flush=True,
        )


async def _send_staged_reply(
    ws: aiohttp.ClientWebSocketResponse,
    req_id: str,
    stream_id: str,
    truncate_test: bool,
) -> None:
    """Send a full-overwrite staged stream reply to confirm the typewriter."""
    stages = ["1", "12", "123", "123 ✅ probe reply"]
    for content in stages:
        await ws.send_str(
            p.encode_frame(
                p.build_stream_reply(req_id, stream_id, content, finish=False)
            )
        )
        await asyncio.sleep(0.5)
    final = "123 ✅ probe reply (done)"
    if truncate_test:
        final = "X" * (p.STREAM_CONTENT_MAX_BYTES + 500)
        print(
            f"  -> truncate-test: sending {len(final)} chars "
            f"(cap is {p.STREAM_CONTENT_MAX_BYTES} bytes)",
            flush=True,
        )
    await ws.send_str(
        p.encode_frame(p.build_stream_reply(req_id, stream_id, final, finish=True))
    )
    print(
        f"  -> SENT staged streaming reply (req_id={req_id}, stream_id={stream_id})",
        flush=True,
    )


async def _heartbeat(ws: aiohttp.ClientWebSocketResponse) -> None:
    try:
        while True:
            await asyncio.sleep(30)
            await ws.send_str(p.encode_frame(p.build_ping()))
            print(f"[{_ts()}] SENT ping", flush=True)
    except asyncio.CancelledError:
        raise


async def run(bot_id: str, secret: str, do_reply: bool, truncate_test: bool) -> None:
    _banner(f"Connecting to {WECOM_WS_URL}")
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(WECOM_WS_URL, heartbeat=None) as ws:
            sub = p.build_subscribe(bot_id, secret)
            await ws.send_str(p.encode_frame(sub))
            print(f"[{_ts()}] SENT subscribe: {p.encode_frame(sub)}", flush=True)
            print(
                "    (the NEXT inbound frame is the AUTH-ACK — capture it as [A])",
                flush=True,
            )

            hb = asyncio.create_task(_heartbeat(ws))
            try:
                async for msg in ws:
                    if msg.type != aiohttp.WSMsgType.TEXT:
                        print(
                            f"[{_ts()}] non-text frame: type={msg.type.name} "
                            f"data={msg.data!r}",
                            flush=True,
                        )
                        if msg.type in (
                            aiohttp.WSMsgType.CLOSED,
                            aiohttp.WSMsgType.CLOSING,
                            aiohttp.WSMsgType.ERROR,
                        ):
                            print(f"  exc: {ws.exception()}", flush=True)
                            break
                        continue
                    raw = msg.data
                    _dump_raw("RECV", raw)
                    frame = _show_codec_view(raw)
                    if frame is None:
                        continue
                    if frame.command == p.CMD_MSG_CALLBACK:
                        _show_handler_view(frame)
                        if do_reply and frame.req_id:
                            # Phase 1 uses req_id as the stream id.
                            await _send_staged_reply(
                                ws, frame.req_id, frame.req_id, truncate_test
                            )
                        elif do_reply:
                            print(
                                "  !! cannot reply: no req_id under assumed paths",
                                flush=True,
                            )
            finally:
                hb.cancel()


def main() -> int:
    parser = argparse.ArgumentParser(description="WeCom long-connection probe")
    parser.add_argument("--bot-id", default=os.environ.get("WECOM_BOT_ID"))
    parser.add_argument("--secret", default=os.environ.get("WECOM_CONNECTION_SECRET"))
    parser.add_argument("--no-reply", action="store_true", help="observe only")
    parser.add_argument(
        "--truncate-test",
        action="store_true",
        help="send a >20480-byte reply to confirm truncation",
    )
    args = parser.parse_args()

    if not args.bot_id or not args.secret:
        print(
            "ERROR: provide --bot-id/--secret or set WECOM_BOT_ID / "
            "WECOM_CONNECTION_SECRET",
            file=sys.stderr,
        )
        return 2

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.add_signal_handler(signal.SIGINT, loop.stop)
    except (NotImplementedError, RuntimeError):
        pass

    try:
        loop.run_until_complete(
            run(args.bot_id, args.secret, not args.no_reply, args.truncate_test)
        )
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("\n[probe] interrupted, closing.", flush=True)
    finally:
        loop.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
