# SPDX-License-Identifier: Apache-2.0
"""Phase-2 brief generation: code assembles a grounded per-node packet, the LLM
narrates requirements/emphasis, code merges deterministic fields back. Chapter-
batched with capped concurrency. Never lets the LLM set coverage or word floors."""

import asyncio

from app.services.bid.coverage import resolve_section_grounding
from app.services.bid.draft_pipeline import flatten_sections
from app.services.bid.specialists import call_brief_writer
from app.services.bid.tender_normalize import ensure_normalized_tender
from app.services.bid.workspace import BidWorkspace

_BRIEF_CONCURRENCY = 3

# Per-node brief-generation status file (written under workspace/).
_BRIEF_STATUS = "workspace/_briefs_status.json"

# importance -> (wordMin, wordMax) floor tier (strings to match NodeBrief shape).
_WORD_FLOOR = {"高": ("1500", "2500"), "中": ("800", "1500"), "低": ("500", "900")}


def init_brief_status(ws: BidWorkspace, node_ids: list[str]) -> None:
    ws.write_json(
        _BRIEF_STATUS,
        {
            "total": len(node_ids),
            "nodes": {nid: "pending" for nid in node_ids},
            "finished": False,
            "error": None,
        },
    )


def read_brief_status(ws: BidWorkspace) -> dict:
    p = ws.path(_BRIEF_STATUS)
    if not p.exists():
        return {"total": 0, "nodes": {}, "finished": False, "error": None}
    return ws.read_json(_BRIEF_STATUS)


def set_brief_node_status(ws: BidWorkspace, node_id: str, status: str) -> None:
    st = read_brief_status(ws)
    st["nodes"][str(node_id)] = status
    ws.write_json(_BRIEF_STATUS, st)


def mark_brief_finished(ws: BidWorkspace, error: str | None = None) -> None:
    st = read_brief_status(ws)
    st["finished"] = True
    st["error"] = error
    ws.write_json(_BRIEF_STATUS, st)


def _importance(node: dict, tender: dict) -> str:
    g = resolve_section_grounding(node, tender)
    if any(c.get("veto") for c in g["clauses"]):
        return "高"
    w = sum(float(s.get("weight") or 0) for s in g["scoring"])
    return "高" if w >= 20 else "中" if w > 0 else "低"


def _word_floor(importance: str) -> tuple[str, str]:
    return _WORD_FLOOR.get(importance, ("800", "1500"))


def _node_packet(node: dict, tender: dict, briefs_doc: dict) -> dict:
    g = resolve_section_grounding(node, tender)
    nid = str(node["id"])
    mats = [
        m["name"]
        for m in briefs_doc.get("materials", [])
        if nid in (m.get("linkedNodeIds") or [])
    ]
    return {
        "id": nid,
        "title": node.get("title") or "",
        "scoring_to_cover": g["scoring"],
        "mandatory_clauses": g["clauses"],
        "must_keep": node.get("must_keep") or [],
        "materials": mats,
        "importance": _importance(node, tender),
    }


def _chapter_batches(outline: dict, node_ids: set[str]) -> list[list[dict]]:
    """Group requested nodes by their top-level chapter subtree so a batch's LLM
    call sees sibling context (briefs don't overlap)."""
    sections = outline.get("sections") or []
    batches: list[list[dict]] = []
    for chapter in sections:
        group = [
            n
            for n in flatten_sections({"sections": [chapter]})
            if str(n.get("id")) in node_ids
        ]
        if group:
            batches.append(group)
    return batches


async def generate_briefs(
    ws: BidWorkspace,
    *,
    model: str,
    model_config: dict | None,
    node_ids: list[str],
    project_id: int | None = None,
    user_id: int | None = None,
) -> dict[str, dict]:
    from app.services.bid import materials_service

    tender = ws.read_json(ensure_normalized_tender(ws))
    outline = ws.read_json("workspace/outline.json")
    briefs_doc = materials_service.read_briefs(ws)
    want = {str(i) for i in node_ids}
    by_id = {
        str(n["id"]): n for n in flatten_sections(outline) if str(n.get("id")) in want
    }
    batches = _chapter_batches(outline, want)

    sem = asyncio.Semaphore(_BRIEF_CONCURRENCY)

    async def run_batch(nodes: list[dict]) -> dict[str, dict]:
        packets = [_node_packet(n, tender, briefs_doc) for n in nodes]
        async with sem:
            return await call_brief_writer(
                model=model,
                model_config=model_config,
                nodes_ctx=packets,
                project_id=project_id,
                user_id=user_id,
            )

    results = await asyncio.gather(*[run_batch(b) for b in batches])
    llm: dict[str, dict] = {}
    for r in results:
        llm.update(r)

    out: dict[str, dict] = {}
    for nid, node in by_id.items():
        imp = _importance(node, tender)
        wmin, wmax = _word_floor(imp)
        narrated = llm.get(nid, {"requirements": "", "emphasis": ""})
        out[nid] = {
            "requirements": narrated.get("requirements", ""),
            "emphasis": narrated.get("emphasis", ""),
            "wordMin": wmin,
            "wordMax": wmax,
            "needFigure": "是" if imp == "高" else "否",
            "importance": imp,
        }
    return out
