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


@pytest.mark.asyncio
async def test_run_agent_posts_v1responses_with_bot():
    # C1: execute goes direct to envd /v1/responses (not em /sandboxes/{id}/execute,
    # which is a platform regression). metadata.bot must carry shell_type +
    # agent_config.env or the executor rejects with "Unsupported agent type: ''".
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=False)
    client = AsyncMock()
    client.post.return_value = _resp({"status": "queued"}, 200)
    with patch("app.services.bid.sandbox_runtime.httpx.AsyncClient") as C:
        C.return_value.__aenter__.return_value = client
        await rt.run_agent(
            "http://localhost:10001",
            prompt="draft it",
            instructions="sys",
            model="mimo-v2.5",
            model_config={"api_key": "k"},
            bot_env={"env": {"model": "claude", "model_id": "mimo-v2.5"}},
            task_id=2000000030,
            subtask_id=2000000030,
            user_id=1,
            user_name="admin",
        )
    url = client.post.call_args[0][0]
    assert url == "http://localhost:10001/v1/responses"  # C1: envd, not em
    body = client.post.call_args[1]["json"]
    assert body["background"] is True and body["input"] == "draft it"
    bot = body["metadata"]["bot"][0]
    assert bot["shell_type"] == "ClaudeCode"  # C1: agent type
    assert bot["agent_config"]["env"]["model"] == "claude"  # C1: model injection
    assert body["metadata"]["subtask_id"] == 2000000030


@pytest.mark.asyncio
async def test_run_agent_raises_on_non_2xx():
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=False)
    client = AsyncMock()
    client.post.return_value = _resp({"detail": "bad"}, 500)
    with patch("app.services.bid.sandbox_runtime.httpx.AsyncClient") as C:
        C.return_value.__aenter__.return_value = client
        with pytest.raises(RuntimeError):
            await rt.run_agent(
                "http://localhost:10001",
                prompt="x",
                instructions="y",
                model="m",
                model_config={},
                bot_env={"env": {"model": "claude"}},
                task_id=1,
                subtask_id=1,
                user_id=1,
                user_name="u",
            )


@pytest.mark.asyncio
async def test_await_file_polls_until_present():
    # C2: completion detection = poll envd output file (no executions endpoint).
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=False)
    # read_file returns None twice then bytes; must use a real async generator
    # of side effects keyed on call order.
    reads = iter([None, None, b"DONE"])

    async def fake_read(envd, remote_path):
        return next(reads)

    with patch.object(rt, "read_file", new=AsyncMock(side_effect=fake_read)):
        present = await rt.await_file(
            "http://localhost:10001", "/home/user/sections/s1.md", poll_s=0, max_tries=5
        )
    assert present is True


@pytest.mark.asyncio
async def test_await_file_returns_false_on_timeout():
    rt = SandboxRuntime(em_url="http://em:8001", rewrite_host=False)
    with patch.object(rt, "read_file", new=AsyncMock(return_value=None)):
        present = await rt.await_file(
            "http://localhost:10001", "/home/user/sections/x.md", poll_s=0, max_tries=3
        )
    assert present is False
