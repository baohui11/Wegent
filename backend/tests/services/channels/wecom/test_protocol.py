import json

from app.services.channels.wecom import protocol as p


def test_encode_decode_round_trip():
    frame = p.WeComFrame(command="ping", req_id="r1", payload={"a": 1})
    raw = p.encode_frame(frame)
    back = p.decode_frame(raw)
    assert back.command == "ping"
    assert back.req_id == "r1"
    assert back.payload == {"a": 1}


def test_encode_emits_real_wire_envelope():
    # Verified against the live server: cmd / headers.req_id / body
    frame = p.WeComFrame(command="aibot_subscribe", req_id="r9", payload={"k": "v"})
    wire = json.loads(p.encode_frame(frame))
    assert wire["cmd"] == "aibot_subscribe"
    assert wire["headers"]["req_id"] == "r9"
    assert wire["body"] == {"k": "v"}
    assert "command" not in wire and "payload" not in wire


def test_encode_ping_has_no_body():
    # ping carries no body (verified against the live server)
    wire = json.loads(p.encode_frame(p.build_ping()))
    assert wire["cmd"] == "ping"
    assert "body" not in wire
    assert wire["headers"]["req_id"].startswith("ping_")


def test_build_subscribe():
    frame = p.build_subscribe("bot123", "sek")
    assert frame.command == p.CMD_SUBSCRIBE
    assert frame.req_id.startswith("aibot_subscribe_")
    assert frame.payload["bot_id"] == "bot123"
    assert frame.payload["secret"] == "sek"


def test_build_stream_reply():
    frame = p.build_stream_reply(
        req_id="r9", stream_id="s9", content="hi", finish=False
    )
    assert frame.command == p.CMD_RESPOND
    assert frame.req_id == "r9"
    assert frame.payload["msgtype"] == "stream"
    assert frame.payload["stream"]["id"] == "s9"
    assert frame.payload["stream"]["content"] == "hi"
    assert frame.payload["stream"]["finish"] is False


def test_truncate_stream_content_under_cap():
    assert p.truncate_stream_content("abc") == "abc"


def test_truncate_stream_content_over_cap():
    big = "x" * (p.STREAM_CONTENT_MAX_BYTES + 100)
    out = p.truncate_stream_content(big)
    assert len(out.encode("utf-8")) <= p.STREAM_CONTENT_MAX_BYTES
    assert out.endswith("…(内容过长已截断)")


def test_truncate_stream_content_multibyte_boundary():
    # Cut must land on a UTF-8 boundary even when the budget falls mid-char.
    big = "你" * (p.STREAM_CONTENT_MAX_BYTES // 2)
    out = p.truncate_stream_content(big)
    encoded = out.encode("utf-8")  # must not raise; valid UTF-8
    assert len(encoded) <= p.STREAM_CONTENT_MAX_BYTES
    assert out.endswith("…(内容过长已截断)")


def test_decode_real_single_chat_callback():
    # The exact frame captured from the live bot (single chat "hello").
    raw = json.dumps(
        {
            "cmd": "aibot_msg_callback",
            "headers": {"req_id": "qROhhoetSASU6h8dDZJDHQAA"},
            "body": {
                "msgid": "ea2c2f48846eb18046346c563ef4d34a",
                "aibotid": "aibFVD3",
                "chattype": "single",
                "from": {"userid": "LiWeiXia"},
                "msgtype": "text",
                "text": {"content": "hello"},
            },
        }
    )
    frame = p.decode_frame(raw)
    assert frame.command == p.CMD_MSG_CALLBACK
    assert frame.req_id == "qROhhoetSASU6h8dDZJDHQAA"
    assert frame.payload["from"]["userid"] == "LiWeiXia"
    assert frame.payload["text"]["content"] == "hello"
    assert frame.payload["chattype"] == "single"
    assert frame.payload["msgid"] == "ea2c2f48846eb18046346c563ef4d34a"


def test_decode_ack_frame_has_errcode_and_no_cmd():
    # Server ack/response frames carry no cmd; identified by req_id + errcode.
    raw = '{"headers": {"req_id": "x"}, "errcode": 0, "errmsg": "ok"}'
    frame = p.decode_frame(raw)
    assert frame.command == ""
    assert frame.req_id == "x"
    assert frame.errcode == 0
    assert frame.errmsg == "ok"
