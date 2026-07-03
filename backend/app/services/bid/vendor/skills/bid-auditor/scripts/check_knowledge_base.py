#!/usr/bin/env python3
"""校验背书型章节的 knowledge_briefs 与知识库核验状态。"""
import argparse
import json
import sys
from pathlib import Path


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def iter_outline_sections(outline):
    seen = set()
    for sec in outline.get("sections", []):
        sid = sec.get("id")
        if sid in seen:
            continue
        if sid:
            seen.add(sid)
        yield sec
    for volume in outline.get("volumes", []):
        for sec in volume.get("sections", []):
            sid = sec.get("id")
            if sid in seen:
                continue
            if sid:
                seen.add(sid)
            yield sec


def category_items(kb, category):
    root = kb.get("bidder_knowledge_base", kb)
    items = root.get(category, [])
    if isinstance(items, dict):
        normalized = []
        for item_id, item in items.items():
            if isinstance(item, dict):
                normalized.append({**item, "id": item.get("id") or item_id})
        return normalized
    if isinstance(items, list):
        return items
    return []


def category_index(kb, category):
    return {
        item.get("id"): item
        for item in category_items(kb, category)
        if isinstance(item, dict) and item.get("id")
    }


def has_verified_item(kb, category):
    return any(
        item.get("verification_status") == "verified"
        for item in category_items(kb, category)
        if isinstance(item, dict)
    )


def run(outline_path, knowledge_base_path):
    outline = load(outline_path)
    kb = load(knowledge_base_path)
    issues = []

    for sec in iter_outline_sections(outline):
        for brief in sec.get("knowledge_briefs", []) or []:
            category = brief.get("knowledge_category")
            topic = brief.get("topic") or category or "未命名背书主题"
            fallback = brief.get("fallback_text") or ""
            if "待填(来源:" not in fallback:
                issues.append(
                    {
                        "desc": f"知识背书「{topic}」缺少合规 fallback_text，应包含 待填(来源:...)",
                        "severity": "high",
                        "veto": False,
                        "section_id": sec.get("id"),
                        "knowledge_category": category,
                    }
                )

            verified_ids = brief.get("verified_item_ids") or []
            indexed_items = category_index(kb, category)
            for item_id in verified_ids:
                item = indexed_items.get(item_id)
                if not item:
                    issues.append(
                        {
                            "desc": f"知识背书「{topic}」引用素材 {item_id} 不存在于知识库分类 {category}",
                            "severity": "high",
                            "veto": False,
                            "section_id": sec.get("id"),
                            "knowledge_category": category,
                            "item_id": item_id,
                        }
                    )
                    continue
                if item.get("verification_status") != "verified":
                    issues.append(
                        {
                            "desc": f"知识背书「{topic}」引用素材 {item_id} 未核验：verification_status={item.get('verification_status')}",
                            "severity": "high",
                            "veto": False,
                            "section_id": sec.get("id"),
                            "knowledge_category": category,
                            "item_id": item_id,
                        }
                    )
                    continue

            if (
                brief.get("requires_verified_evidence") is True
                and not verified_ids
                and not has_verified_item(kb, category)
            ):
                issues.append(
                    {
                        "desc": f"知识背书「{topic}」缺少已核验素材：分类 {category}",
                        "severity": "medium",
                        "veto": False,
                        "section_id": sec.get("id"),
                        "knowledge_category": category,
                    }
                )

    return {"check": "knowledge_base", "ok": len(issues) == 0, "issues": issues}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outline", required=True)
    ap.add_argument("--knowledge-base", required=True)
    args = ap.parse_args()
    res = run(args.outline, args.knowledge_base)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
