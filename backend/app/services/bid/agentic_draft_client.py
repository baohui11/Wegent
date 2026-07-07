# SPDX-License-Identifier: Apache-2.0
"""Client for the pi_runtime sidecar: map the resolved model config to the
sidecar's request shape, mount the vendor skill into the shared workspace, POST
one section, and judge usability. Contains no drafting logic — the prompt and
fallback live in draft_pipeline."""
import re
import shutil
from pathlib import Path

import httpx

from app.services.bid.workspace import BidWorkspace

# Tool whitelist validated in the bake-off (read/grep/find/ls to explore, then
# write/edit to incrementally persist the section).
_TOOLS = ["read", "grep", "find", "ls", "write", "edit"]
_VENDOR_SKILL = Path(__file__).parent / "vendor" / "skills" / "bid-section-writer"


def sidecar_model(model_id: str, model_config: dict | None) -> dict:
    """Map the chat_shell-resolved model_config to the sidecar's model object.

    ``default_headers`` carries gateway auth (e.g. {"user": "admin"}); the
    sidecar forwards them as the provider's request headers (see
    bridge-config.mjs). If a Model CRD has no default_headers, the gateway auth
    is absent and the agent call fails -> the caller falls back to ghostwriter.
    """
    cfg = model_config or {}
    return {
        "id": model_id,
        "base_url": cfg.get("base_url") or "",
        "api_key": cfg.get("api_key") or "",
        "headers": cfg.get("default_headers") or {},
        "context_window": int(cfg.get("context_window") or 80000),
        "max_tokens": int(cfg.get("max_output_tokens") or 8192),
    }


def mount_section_writer_skill(ws: BidWorkspace) -> None:
    """Copy the vendored bid-section-writer skill into <ws>/skills/ so the agent
    can read SKILL.md + the style reference (guardrail #1)."""
    dst = ws.path("skills/bid-section-writer")
    if dst.exists():
        shutil.rmtree(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(_VENDOR_SKILL, dst)


def usable(md_path: Path, min_chars: int) -> bool:
    """Non-space char floor — the validated usable gate (真·C ≥ 500)."""
    if not md_path.exists():
        return False
    text = md_path.read_text(encoding="utf-8")
    return len(re.sub(r"\s", "", text)) >= min_chars


async def draft_via_sidecar(
    *,
    ws: BidWorkspace,
    section_id: str,
    prompt: str,
    model: dict,
    timeout_s: int,
    max_iters: int,
    base_url: str,
) -> dict:
    """POST one section draft to the pi_runtime sidecar; raise on HTTP error so
    the caller can fall back. The agent writes directly into the shared
    workspace volume at workspace/sections/<id>.md."""
    body = {
        "workspace_path": str(ws.path("")),
        "section_id": section_id,
        "prompt": prompt,
        "tools": _TOOLS,
        "model": model,
        "timeout_s": timeout_s,
        "max_iters": max_iters,
    }
    # HTTP timeout a bit beyond the agent's hard timeout so the sidecar (which
    # kills pi at timeout_s) can respond before the client gives up.
    async with httpx.AsyncClient(timeout=timeout_s + 30) as client:
        resp = await client.post(
            base_url.rstrip("/") + "/internal/pi/draft-section", json=body
        )
        resp.raise_for_status()
        return resp.json()
