#!/usr/bin/env python3
"""数字一致性：报价表合计、投标函金额、正文出现的金额三者必须一致。"""
import argparse
import json
import re
import sys
from pathlib import Path

AMOUNT_RE = re.compile(r"人民币\s*([0-9,]+(?:\.[0-9]+)?)\s*元")


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def to_num(s):
    return float(s.replace(",", ""))


def run(pricing_path, sections_dir):
    pricing = load(pricing_path)
    sections_dir = Path(sections_dir)
    issues = []

    items_sum = round(sum(i["amount"] for i in pricing.get("items", [])), 2)
    total = pricing.get("total_quote")
    letter = pricing.get("bid_letter_amount")

    if total is not None and items_sum != total:
        issues.append(
            {
                "desc": f"报价表分项合计 {items_sum:.2f} 与总报价 {total:.2f} 不一致",
                "severity": "high",
                "veto": False,
            }
        )
    if total is not None and letter is not None and letter != total:
        issues.append(
            {
                "desc": f"投标函金额 {letter:.2f} 与报价表总报价 {total:.2f} 不一致（常见废标点）",
                "severity": "high",
                "veto": True,
            }
        )

    # 正文里出现的金额必须等于总报价
    for f in sorted(sections_dir.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        for m in AMOUNT_RE.finditer(text):
            amt = to_num(m.group(1))
            if total is not None and amt != total:
                issues.append(
                    {
                        "desc": f"{f.name} 正文金额 人民币{m.group(1)}元 与总报价 {total:.2f} 不一致",
                        "severity": "medium",
                        "veto": False,
                    }
                )

    return {
        "check": "numbers",
        "ok": len(issues) == 0,
        "stats": {
            "items_sum": items_sum,
            "total_quote": total,
            "bid_letter_amount": letter,
        },
        "issues": issues,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pricing", required=True)
    ap.add_argument("--sections", required=True)
    args = ap.parse_args()
    res = run(args.pricing, args.sections)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
