#!/usr/bin/env python3
"""把 tender_parts/*.json 校验式合并成单个 tender.json。
确定性保证：①必备键存在（治整块漏抽）②键冲突检测 ③跨块引用闭合（Task 2 追加）。
缺块/冲突/悬空 → 记入 _meta.merge_issues 并非零退出（仍产出文件供排查）。"""
import argparse
import json
import sys
from pathlib import Path

REQUIRED_BLOCKS = [
    "project",
    "qualifications",
    "scoring",
    "mandatory_clauses",
    "submission_rules",
    "required_outline",
    "requirements",
    "commitment_terms",
    "target_package",
]
MERGEABLE_KEYS = {"notes"}  # 元信息键：多 part 都可写，跨 part 累积成 list，不算冲突


def merge_parts(parts_dir):
    merged, conflicts, bad = {}, [], []
    notes_acc = []
    for f in sorted(Path(parts_dir).glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            bad.append(
                {"file": f.name, "msg": f"line {e.lineno} col {e.colno}: {e.msg}"}
            )
            continue
        for k, v in data.items():
            if k in MERGEABLE_KEYS:
                notes_acc.extend(v if isinstance(v, list) else [v])
                continue
            if k in merged:
                conflicts.append(k)
            merged[k] = v
    if notes_acc:
        merged["notes"] = notes_acc
    return merged, conflicts, bad


def validate(merged, conflicts, bad=None):
    issues = []
    for b in bad or []:
        issues.append(
            {
                "desc": f"分块 {b['file']} JSON 解析失败（{b['msg']}）；只需回拆标重写该 part 再合并",
                "severity": "high",
                "veto": False,
            }
        )
    for k in sorted(set(conflicts)):
        issues.append(
            {
                "desc": f"分块合并键冲突：{k} 被多个 part 重复定义",
                "severity": "high",
                "veto": False,
            }
        )
    for b in REQUIRED_BLOCKS:
        if b not in merged:
            issues.append(
                {
                    "desc": f"缺必备区块：{b}（分块漏抽）",
                    "severity": "high",
                    "veto": False,
                }
            )
    issues += check_closure(merged)
    return issues


def _outline_titles(required_outline):
    titles = set()

    def walk(secs):
        for s in secs or []:
            t = s.get("title")
            if t:
                titles.add(t)
            walk(s.get("children"))

    if isinstance(required_outline, dict):
        walk(required_outline.get("sections"))
    return titles


def check_closure(merged):
    issues = []
    req_ids = {
        r.get("id")
        for r in merged.get("requirements", [])
        if isinstance(r, dict) and r.get("id")
    }
    titles = _outline_titles(merged.get("required_outline"))
    do = merged.get("derived_outline") or {}
    refs = list(do.get("requirement_groups") or []) + list(
        do.get("section_expansions") or []
    )
    for ref in refs:
        ts = ref.get("target_section")
        if ts and ts not in titles:
            issues.append(
                {
                    "desc": f"derived_outline.target_section 悬空：{ts!r} 不在 required_outline 标题",
                    "severity": "high",
                    "veto": False,
                }
            )
        for rid in ref.get("requirement_ids") or []:
            if rid not in req_ids:
                issues.append(
                    {
                        "desc": f"derived_outline 引用 requirement_id 悬空：{rid}",
                        "severity": "high",
                        "veto": False,
                    }
                )
    for s in merged.get("scoring", []):
        if not isinstance(s, dict):
            continue
        if s.get("target_scope") == "whole_technical_volume":
            continue  # 整册评价类无单一对应章节，由前置响应索引表整体承载
        ts = s.get("target_section")
        if ts and ts not in titles:
            issues.append(
                {
                    "desc": f"scoring.target_section 悬空：{ts!r} 不在 required_outline 标题"
                    f"（评分项 {s.get('id')}）",
                    "severity": "high",
                    "veto": False,
                }
            )
    return issues


def run(parts_dir, out_path):
    merged, conflicts, bad = merge_parts(parts_dir)
    issues = validate(merged, conflicts, bad)
    merged.setdefault("_meta", {})["merge_issues"] = [i["desc"] for i in issues]
    Path(out_path).write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": len(issues) == 0, "issues": issues, "blocks": sorted(merged.keys())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parts", default="workspace/tender_parts")
    ap.add_argument("--out", default="workspace/tender.json")
    args = ap.parse_args()
    res = run(args.parts, args.out)
    print(
        json.dumps(
            {
                "ok": res["ok"],
                "blocks": res["blocks"],
                "issues": [i["desc"] for i in res["issues"]],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
