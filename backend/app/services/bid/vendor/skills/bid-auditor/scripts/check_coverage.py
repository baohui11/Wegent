#!/usr/bin/env python3
"""评分项覆盖率 + 废标(★)条款覆盖 + must_keep 词命中校验。"""
import argparse
import json
import re
import sys
from pathlib import Path


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


_MK_TOKEN_RE = re.compile(r"[0-9]+|[A-Za-z]+|[一-鿿]+")


def _match_must_keep(keyword, text):
    """token-subset 匹配：keyword 切成 数字/英文/CJK 连续段，
    对去标点空白后的正文要求每个 token 都出现（容忍措辞插入，但缺任一 token 仍判漏）。"""
    tokens = _MK_TOKEN_RE.findall(keyword)
    if not tokens:
        return keyword in text
    norm = re.sub(r"\W", "", text)
    return all(t in norm for t in tokens)


def iter_outline_sections(outline):
    """遍历装订主干与独立分册，商务/报价不进技术目录但仍参与覆盖检查。"""
    seen = set()
    for sec in outline.get("sections", []):
        sid = sec.get("id")
        if sid and sid not in seen:
            seen.add(sid)
            yield sec
    for volume in outline.get("volumes", []):
        for sec in volume.get("sections", []):
            sid = sec.get("id")
            if sid and sid not in seen:
                seen.add(sid)
                yield sec


def run(tender_path, outline_path, sections_dir):
    tender = load(tender_path)
    outline = load(outline_path)
    sections_dir = Path(sections_dir)

    covered = set()
    section_text = {}
    outline_sections = list(iter_outline_sections(outline))
    for sec in outline_sections:
        sid = sec["id"]
        for c in sec.get("covers", []):
            covered.add(c)
        f = sections_dir / f"{sid}.md"
        section_text[sid] = f.read_text(encoding="utf-8") if f.exists() else ""

    issues = []

    # 1. 评分项覆盖
    for s in tender.get("scoring", []):
        if s["category"] == "价格":
            continue  # 价格由报价表处理，不在正文覆盖范围
        if s["id"] not in covered:
            issues.append(
                {
                    "desc": f"评分项 {s['id']}（{s['item']}，{s['weight']}分）未被任何章节覆盖",
                    "severity": "high",
                    "veto": False,
                    "scoring_id": s["id"],
                }
            )

    # 2. ★ 废标条款覆盖
    for m in tender.get("mandatory_clauses", []):
        if m.get("veto") and m["id"] not in covered:
            issues.append(
                {
                    "desc": f"废标条款 {m['id']}（{m['marker']} {m['desc']}）未被覆盖",
                    "severity": "high",
                    "veto": True,
                    "clause_id": m["id"],
                }
            )

    # 3. must_keep 词必须出现在覆盖该评分项的章节正文里；
    #    whole_technical_volume 评分项无单一对应章节，改在全技术册正文里搜。
    sec_by_cover = {}
    for sec in outline_sections:
        for c in sec.get("covers", []):
            sec_by_cover.setdefault(c, []).append(sec["id"])
    technical_text = "\n".join(
        section_text.get(sec.get("id"), "") for sec in outline.get("sections", [])
    )
    for s in tender.get("scoring", []):
        whole = s.get("target_scope") == "whole_technical_volume"
        for kw in s.get("must_keep", []) or []:
            if whole:
                hit = _match_must_keep(kw, technical_text)
            else:
                sids = sec_by_cover.get(s["id"], [])
                hit = any(
                    _match_must_keep(kw, section_text.get(sid, "")) for sid in sids
                )
            if not hit:
                issues.append(
                    {
                        "desc": f"评分项 {s['id']} 的 must_keep 关键词「{kw}」未在对应章节正文出现",
                        "severity": "medium",
                        "veto": False,
                        "scoring_id": s["id"],
                        "keyword": kw,
                    }
                )

    total = len([s for s in tender.get("scoring", []) if s["category"] != "价格"])
    non_price_ids = {
        s["id"] for s in tender.get("scoring", []) if s["category"] != "价格"
    }
    return {
        "check": "coverage",
        "ok": len(issues) == 0,
        "stats": {
            "scoring_total": total,
            "scoring_covered": len(covered & non_price_ids),
        },
        "issues": issues,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--outline", required=True)
    ap.add_argument("--sections", required=True)
    args = ap.parse_args()
    res = run(args.tender, args.outline, args.sections)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
