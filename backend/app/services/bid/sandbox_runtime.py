# SPDX-License-Identifier: Apache-2.0
"""Thin async client over executor_manager sandbox API + envd file API,
used by bid drafting. No Task row involved (synthetic task_id)."""

import asyncio

import httpx

_SANDBOX_API = "/executor-manager/sandboxes"


class SandboxRuntime:
    def __init__(self, *, em_url: str, rewrite_host: bool):
        self._em = em_url.rstrip("/")
        self._rewrite_host = rewrite_host

    def _envd(self, base_url: str) -> str:
        if self._rewrite_host and base_url:
            return base_url.replace("host.docker.internal", "localhost")
        return base_url

    async def create(
        self, *, task_id, user_id, user_name, bot_config, timeout=1800
    ) -> str:
        body = {
            "shell_type": "ClaudeCode",
            "user_id": user_id,
            "user_name": user_name,
            "timeout": timeout,
            "bot_config": bot_config,
            "metadata": {"task_id": task_id, "source": "bid-drafting"},
        }
        async with httpx.AsyncClient(timeout=60.0) as c:
            r = await c.post(f"{self._em}{_SANDBOX_API}", json=body)
            if r.status_code >= 300:
                raise RuntimeError(
                    f"sandbox create failed {r.status_code}: {r.text[:300]}"
                )
            return r.json()["sandbox_id"]

    async def wait_running(self, sandbox_id, poll_s=3, max_tries=40) -> str:
        async with httpx.AsyncClient(timeout=30.0) as c:
            for _ in range(max_tries):
                r = await c.get(f"{self._em}{_SANDBOX_API}/{sandbox_id}")
                data = r.json() if r.status_code < 300 else {}
                if data.get("status") in ("running", "ready") and data.get("base_url"):
                    return self._envd(data["base_url"])
                if data.get("status") in ("error", "failed", "terminated"):
                    raise RuntimeError(f"sandbox {sandbox_id} failed: {data}")
                await asyncio.sleep(poll_s)
        raise TimeoutError(f"sandbox {sandbox_id} not running in time")

    async def delete(self, sandbox_id) -> None:
        try:
            async with httpx.AsyncClient(timeout=30.0) as c:
                await c.delete(f"{self._em}{_SANDBOX_API}/{sandbox_id}")
        except Exception:
            pass  # best-effort; sandbox auto-expires on timeout
