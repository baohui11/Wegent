# SPDX-License-Identifier: Apache-2.0
"""pi_runtime sidecar client tests (Phase 2): model mapping, skill mount,
usable floor, and the POST to /internal/pi/draft-section. No network — httpx
AsyncClient is monkeypatched."""

import httpx
import pytest

from app.services.bid import agentic_draft_client as adc
from app.services.bid.workspace import BidWorkspace


def test_sidecar_model_maps_resolved_config():
    m = adc.sidecar_model(
        "mimo-v2.5",
        {
            "base_url": "https://gw/anthropic",
            "api_key": "sk",
            "model_id": "mimo-v2.5",
            "default_headers": {"user": "admin"},
            "context_window": 80000,
            "max_output_tokens": 8192,
        },
    )
    assert m == {
        "id": "mimo-v2.5",
        "base_url": "https://gw/anthropic",
        "api_key": "sk",
        "headers": {"user": "admin"},
        "context_window": 80000,
        "max_tokens": 8192,
    }


def test_sidecar_model_defaults_on_empty_config():
    m = adc.sidecar_model("m", None)
    assert m == {
        "id": "m",
        "base_url": "",
        "api_key": "",
        "headers": {},
        "context_window": 80000,
        "max_tokens": 8192,
    }


def test_usable_floor(tmp_path):
    p = tmp_path / "s.md"
    p.write_text("  \n\n", encoding="utf-8")
    assert adc.usable(p, 5) is False
    p.write_text("正文" * 10, encoding="utf-8")
    assert adc.usable(p, 5) is True
    assert adc.usable(tmp_path / "missing.md", 5) is False


def test_mount_skill_copies_vendor_skill(tmp_path):
    ws = BidWorkspace("wref", root=tmp_path)
    ws.path("").mkdir(parents=True, exist_ok=True)
    adc.mount_section_writer_skill(ws)
    assert ws.path("skills/bid-section-writer/SKILL.md").exists()


@pytest.mark.asyncio
async def test_draft_via_sidecar_posts_expected_shape(tmp_path, monkeypatch):
    ws = BidWorkspace("wref", root=tmp_path)
    ws.path("").mkdir(parents=True, exist_ok=True)
    captured = {}

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "status": "agent",
                "section_chars": 700,
                "tool_calls": {"total": 16},
                "log_ref": None,
            }

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json):
            captured["url"] = url
            captured["json"] = json
            return FakeResp()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    out = await adc.draft_via_sidecar(
        ws=ws,
        section_id="s1",
        prompt="P",
        model={"id": "m", "base_url": "u", "api_key": "k"},
        timeout_s=420,
        max_iters=40,
        base_url="http://pi_runtime:8300",
    )
    assert out["status"] == "agent"
    assert captured["url"].endswith("/internal/pi/draft-section")
    body = captured["json"]
    assert body["section_id"] == "s1"
    assert body["tools"] == ["read", "grep", "find", "ls", "write", "edit"]
    assert body["timeout_s"] == 420 and body["max_iters"] == 40
    assert body["workspace_path"] == str(ws.path(""))
