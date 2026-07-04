# SPDX-License-Identifier: Apache-2.0
from unittest.mock import AsyncMock, patch

import pytest

from app.services.bid.sandbox_runtime import SandboxRuntime


def _resp(json_body, status=200):
    m = AsyncMock()
    m.status_code = status
    m.json = lambda: json_body
    m.text = str(json_body)
    return m


@pytest.mark.asyncio
async def test_create_posts_expected_payload():
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=True)
    client = AsyncMock()
    client.post.return_value = _resp({"sandbox_id": "2000000030", "status": "running"})
    with patch("app.services.bid.sandbox_runtime.httpx.AsyncClient") as C:
        C.return_value.__aenter__.return_value = client
        sid = await rt.create(
            task_id=2000000030,
            user_id=1,
            user_name="admin",
            bot_config={"env": {"model": "claude"}},
        )
    assert sid == "2000000030"
    url, kwargs = client.post.call_args[0][0], client.post.call_args[1]
    assert url == "http://em:8001/executor-manager/sandboxes"
    body = kwargs["json"]
    assert body["shell_type"] == "ClaudeCode"
    assert body["metadata"]["task_id"] == 2000000030
    assert body["bot_config"]["env"]["model"] == "claude"


@pytest.mark.asyncio
async def test_wait_running_returns_localhost_rewritten_envd():
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=True)
    client = AsyncMock()
    client.get.return_value = _resp(
        {"status": "running", "base_url": "http://host.docker.internal:10001"}
    )
    with patch("app.services.bid.sandbox_runtime.httpx.AsyncClient") as C:
        C.return_value.__aenter__.return_value = client
        envd = await rt.wait_running("2000000030", poll_s=0, max_tries=2)
    assert envd == "http://localhost:10001"


@pytest.mark.asyncio
async def test_seed_and_read_file():
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=False)
    client = AsyncMock()
    client.post.return_value = _resp({}, 200)  # upload ok
    client.get.return_value = _resp("IGNORED", 200)
    client.get.return_value.content = b"BODY"
    with patch("app.services.bid.sandbox_runtime.httpx.AsyncClient") as C:
        C.return_value.__aenter__.return_value = client
        await rt.seed_file("http://localhost:10001", "/home/user/t.txt", b"x", "t.txt")
        body = await rt.read_file("http://localhost:10001", "/home/user/t.txt")
    assert body == b"BODY"
    up_url = client.post.call_args[0][0]
    assert up_url == "http://localhost:10001/files"
    assert client.post.call_args[1]["params"] == {"path": "/home/user/t.txt"}


@pytest.mark.asyncio
async def test_read_file_missing_returns_none():
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=False)
    client = AsyncMock()
    client.get.return_value = _resp("", 404)
    with patch("app.services.bid.sandbox_runtime.httpx.AsyncClient") as C:
        C.return_value.__aenter__.return_value = client
        assert await rt.read_file("http://localhost:10001", "/home/user/none") is None


@pytest.mark.asyncio
async def test_list_dir_returns_entry_paths():
    # C3 verified shape: {"entries":[{"name","path",...}]} -> entry["path"].
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=False)
    client = AsyncMock()
    client.post.return_value = _resp(
        {
            "entries": [
                {"name": "out.md", "path": "/home/user/out.md"},
                {"name": "sections", "path": "/home/user/sections"},
            ]
        },
        200,
    )
    with patch("app.services.bid.sandbox_runtime.httpx.AsyncClient") as C:
        C.return_value.__aenter__.return_value = client
        paths = await rt.list_dir("http://localhost:10001", "/home/user")
    assert paths == ["/home/user/out.md", "/home/user/sections"]
