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

    async def seed_file(
        self, envd, remote_path: str, data: bytes, filename: str
    ) -> None:
        async with httpx.AsyncClient(timeout=120.0) as c:
            r = await c.post(
                f"{envd}/files",
                params={"path": remote_path},
                files={"file": (filename, data)},
            )
            if r.status_code >= 300:
                raise RuntimeError(f"seed {remote_path} failed {r.status_code}")

    async def read_file(self, envd, remote_path: str) -> bytes | None:
        async with httpx.AsyncClient(timeout=60.0) as c:
            r = await c.get(f"{envd}/files", params={"path": remote_path})
            if r.status_code == 404:
                return None
            if r.status_code >= 300:
                raise RuntimeError(f"read {remote_path} failed {r.status_code}")
            return r.content

    async def list_dir(self, envd, path: str, depth: int = 1) -> list[str]:
        async with httpx.AsyncClient(timeout=60.0) as c:
            r = await c.post(
                f"{envd}/filesystem.Filesystem/ListDir",
                json={"path": path, "depth": depth},
            )
            if r.status_code >= 300:
                return []
            data = r.json()
            # ListDir shape VERIFIED (C3): {"entries":[{"name","path",...}]}
            return [e.get("path") or e.get("name") for e in data.get("entries", [])]

    async def run_agent(
        self,
        envd,
        *,
        prompt,
        instructions,
        model,
        model_config,
        bot_env,
        task_id,
        subtask_id,
        user_id,
        user_name,
    ) -> None:
        """Trigger the ClaudeCode agent by POSTing /v1/responses directly to the
        sandbox envd (C1). The platform ``/sandboxes/{id}/execute`` route is a
        regression (404), so bid bypasses it. ``metadata.bot`` MUST carry
        ``shell_type`` + ``agent_config.env`` or the executor raises
        "Unsupported agent type: ''". Returns on 200 — the agent runs async in
        the sandbox; completion is detected by polling output files (C2)."""
        body = {
            "model": model,
            "input": prompt,
            "instructions": instructions,
            "background": True,
            "stream": False,
            "metadata": {
                "task_id": task_id,
                "subtask_id": subtask_id,
                # C1: bot carries agent type (shell_type) + model injection
                # (agent_config.env) so the executor can build the agent.
                "bot": [{"shell_type": "ClaudeCode", "agent_config": bot_env}],
                "user_id": user_id,
                "user_name": user_name,
            },
            "model_config": model_config or {},
        }
        async with httpx.AsyncClient(timeout=120.0) as c:
            r = await c.post(f"{envd}/v1/responses", json=body)
            if r.status_code >= 300:
                raise RuntimeError(
                    f"/v1/responses failed {r.status_code}: {r.text[:300]}"
                )
        # 200 -> {"status":"queued","message":"...RUNNING"}; agent runs async.

    async def await_file(
        self, envd, remote_path, poll_s: int = 4, max_tries: int = 90
    ) -> bool:
        """Poll ``read_file`` until the output appears (C2 completion check).

        Direct /v1/responses calls are not tracked by the executor_manager
        executions endpoint (it returns not-found), so bid detects completion by
        watching for the section file the agent writes."""
        for _ in range(max_tries):
            if await self.read_file(envd, remote_path) is not None:
                return True
            await asyncio.sleep(poll_s)
        return False
