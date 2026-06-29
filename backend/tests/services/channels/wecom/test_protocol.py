from app.services.channels.wecom import protocol as p


def test_encode_decode_round_trip():
    frame = p.WeComFrame(command="ping", req_id="r1", payload={"a": 1})
    raw = p.encode_frame(frame)
    back = p.decode_frame(raw)
    assert back.command == "ping"
    assert back.req_id == "r1"
    assert back.payload == {"a": 1}


def test_build_subscribe():
    frame = p.build_subscribe("bot123", "sek")
    assert frame.command == p.CMD_SUBSCRIBE
    assert frame.payload["bot_id"] == "bot123"
    assert frame.payload["secret"] == "sek"


def test_build_stream_reply():
    frame = p.build_stream_reply(
        req_id="r9", stream_id="s9", content="hi", finish=False
    )
    assert frame.command == p.CMD_RESPOND
    assert frame.req_id == "r9"
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


def test_decode_missing_req_id_is_none():
    raw = '{"command": "aibot_msg_callback", "payload": {}}'
    frame = p.decode_frame(raw)
    assert frame.req_id is None
    assert frame.command == "aibot_msg_callback"
