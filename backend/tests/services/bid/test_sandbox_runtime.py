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
