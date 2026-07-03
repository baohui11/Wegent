#!/usr/bin/env python3
"""eval 基线：把当前案的关键产出冻结为标准答案（--capture），
之后每次改造后比对，输出退化项（--check）。退化即非零退出。"""
import argparse
import json
import re
import sys
from pathlib import Path

# 标题比对对引号字形不敏感：全角弯引号/半角直引号/直角引号都规范化掉再比，
# 避免招标文件/OCR 常见的引号字形差异造成假退化（不掩盖真退化：标题内容变了照样抓）。
_QUOTES_RE = re.compile(r"[\"'“”‘’「」『』]")


def _norm_title(t):
    return _QUOTES_RE.sub("", t or "").strip()


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def _section_titles(outline):
    titles = []
    for sec in outline.get("sections", []):
        t = sec.get("outline_title") or sec.get("title")
        if t:
            titles.append(t)
    return titles


def _covered_scoring_ids(tender, outline):
    covered = set()
    for sec in outline.get("sections", []) or []:
        covered.update(sec.get("covers", []) or [])
    for vol in outline.get("volumes", []) or []:
        for sec in vol.get("sections", []) or []:
            covered.update(sec.get("covers", []) or [])
    non_price = {
        s.get("id")
        for s in tender.get("scoring", []) or []
        if s.get("category") != "价格" and s.get("id")
    }
    return sorted(covered & non_price)


def capture(tender_path, outline_path):
    tender = load(tender_path)
    outline = load(outline_path)
    return {
        "min_veto_clauses": len(tender.get("mandatory_clauses", [])),
        "required_section_titles": _section_titles(outline),
        "key_facts": {"project_id": tender.get("project", {}).get("id")},
        "covered_scoring_ids": _covered_scoring_ids(tender, outline),
    }


def check(tender_path, outline_path, golden_path):
    tender = load(tender_path)
    outline = load(outline_path)
    golden = load(golden_path)
    regressions = []

    n = len(tender.get("mandatory_clauses", []))
    if n < golden.get("min_veto_clauses", 0):
        regressions.append(f"红线条款 {n} < 基线 {golden['min_veto_clauses']}")

    have = {_norm_title(t) for t in _section_titles(outline)}
    for t in golden.get("required_section_titles", []):
        if _norm_title(t) not in have:
            regressions.append(f"缺失章节：{t}")

    pid = tender.get("project", {}).get("id")
    want = golden.get("key_facts", {}).get("project_id")
    if want and pid != want:
        regressions.append(f"项目编号漂移：{pid} ≠ 基线 {want}")

    have_cov = set(_covered_scoring_ids(tender, outline))
    for sid in golden.get("covered_scoring_ids", []):
        if sid not in have_cov:
            regressions.append(f"评分项 {sid} 丢失覆盖（基线已覆盖，现未覆盖）")

    return {"ok": not regressions, "regressions": regressions}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--outline", required=True)
    ap.add_argument("--golden", required=True)
    ap.add_argument("--capture", action="store_true", help="把当前产出写成 golden 基线")
    args = ap.parse_args()
    if args.capture:
        Path(args.golden).parent.mkdir(parents=True, exist_ok=True)
        Path(args.golden).write_text(
            json.dumps(
                capture(args.tender, args.outline), ensure_ascii=False, indent=2
            ),
            encoding="utf-8",
        )
        print(f"已冻结基线 → {args.golden}")
        return
    res = check(args.tender, args.outline, args.golden)
    if res["ok"]:
        print("✅ eval 无退化")
    else:
        print("❌ eval 退化：")
        for r in res["regressions"]:
            print("   -", r)
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
