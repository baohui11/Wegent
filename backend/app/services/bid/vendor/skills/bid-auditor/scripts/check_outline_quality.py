#!/usr/bin/env python3
"""校验 required_outline 到 outline.json 的目录契约与 profile 作用范围。"""
import argparse
import json
import sys
from pathlib import Path

POLLUTION_WORDS = ("商务", "资格", "报价", "偏离表", "投标函")
REQUIRED_FRONT_TITLES = ("评分要素响应索引表", "技术规范书响应索引表")
ILLEGAL_NON_CREATIVE_CHILD_SOURCES = {"bidder_outline_profile", "derived_outline"}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def section_contract_title(sec):
    return sec.get("outline_title") or ""


def outline_source_children(sec):
    sources = sec.get("outline_sources") or {}
    if isinstance(sources, dict):
        return sources.get("children")
    return None


def run(tender_path, outline_path):
    tender = load(tender_path)
    outline = load(outline_path)
    required = tender.get("required_outline", {})
    issues = []

    required_front = [
        item.get("title", "") for item in required.get("front_matter", [])
    ]
    required_sections = [item.get("title", "") for item in required.get("sections", [])]
    expected_titles = required_front + required_sections

    outline_sections = outline.get("sections", [])
    contract_sections = [
        sec
        for sec in outline_sections
        if sec.get("outline_type") in ("front_matter", "section")
    ]
    actual_titles = [section_contract_title(sec) for sec in contract_sections]

    for sec in contract_sections:
        if not sec.get("outline_title"):
            issues.append(
                {
                    "desc": f"缺少 outline_title：{sec.get('id') or sec.get('title') or '未命名章节'}",
                    "severity": "high",
                    "veto": False,
                    "section_id": sec.get("id"),
                }
            )

    if expected_titles and actual_titles != expected_titles:
        issues.append(
            {
                "desc": "技术文件主目录与 required_outline 不一致："
                f"期望 {expected_titles}，实际 {actual_titles}",
                "severity": "high",
                "veto": False,
            }
        )

    for sec in outline_sections:
        if sec.get("outline_type") != "section":
            continue
        title = section_contract_title(sec)
        hit_words = [word for word in POLLUTION_WORDS if word in title]
        if hit_words:
            issues.append(
                {
                    "desc": f"技术文件主目录被污染：章节「{title}」包含 {'、'.join(hit_words)}",
                    "severity": "high",
                    "veto": False,
                    "section_id": sec.get("id"),
                }
            )

    required_by_title = {
        item.get("title"): item
        for item in required.get("sections", [])
        if item.get("title")
    }
    for sec in outline_sections:
        if sec.get("outline_type") != "section":
            continue
        title = section_contract_title(sec)
        req = required_by_title.get(title)
        if (
            req
            and req.get("creative_required") is False
            and outline_source_children(sec) in ILLEGAL_NON_CREATIVE_CHILD_SOURCES
        ):
            issues.append(
                {
                    "desc": f"非格式自拟章节「{title}」不得使用 derived/profile 子结构扩写子目录",
                    "severity": "medium",
                    "veto": False,
                    "section_id": sec.get("id"),
                }
            )

    present_titles = set(actual_titles)
    for title in REQUIRED_FRONT_TITLES:
        if title not in present_titles:
            issues.append(
                {
                    "desc": f"缺少前置响应索引表：{title}",
                    "severity": "high",
                    "veto": False,
                }
            )

    return {"check": "outline_quality", "ok": len(issues) == 0, "issues": issues}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--outline", required=True)
    args = ap.parse_args()
    res = run(args.tender, args.outline)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
