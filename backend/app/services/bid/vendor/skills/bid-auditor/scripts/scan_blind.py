#!/usr/bin/env python3
"""暗标泄密扫描：技术文件正文里不得出现投标人可识别信息。"""
import argparse
import json
import re
import sys
from pathlib import Path

# 公司名（含括注地名）、电话、邮箱、网址等可识别信息
COMPANY_RE = re.compile(
    r"[\u4e00-\u9fa5A-Za-z]{2,}(?:（[\u4e00-\u9fa5]+）)?(?:科技|信息|技术|咨询|工程|网络|软件|数据|系统|管理)(?:（[\u4e00-\u9fa5]+）)?(?:股份)?(?:有限)?公司"
)
PHONE_RE = re.compile(r"(?<!\d)(?:0\d{2,3}-?\d{7,8}|1[3-9]\d{9})(?!\d)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s）)]+")


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def scan_line(line):
    hits = []
    for label, rx in (
        ("公司名", COMPANY_RE),
        ("电话", PHONE_RE),
        ("邮箱", EMAIL_RE),
        ("网址", URL_RE),
    ):
        for m in rx.finditer(line):
            hits.append((label, m.group(0)))
    return hits


def run(tender_path, sections_dir):
    tender = load(tender_path)
    sections_dir = Path(sections_dir)
    rules = tender.get("submission_rules", {})
    if not rules.get("blind_bid"):
        return {
            "check": "blind",
            "ok": True,
            "issues": [],
            "stats": {"blind_bid": False},
        }

    issues = []
    extra = set()
    corpus_name = rules.get("_bidder_name")
    if corpus_name:
        extra.add(corpus_name)

    for f in sorted(sections_dir.glob("*.md")):
        for ln, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            hits = scan_line(line)
            for name in extra:
                if name in line:
                    hits.append(("投标人名称", name))
            for label, val in hits:
                issues.append(
                    {
                        "desc": f"{f.name}:{ln} 出现暗标泄密信息（{label}）：{val}",
                        "severity": "high",
                        "veto": True,
                        "file": f.name,
                        "line": ln,
                    }
                )

    return {
        "check": "blind",
        "ok": len(issues) == 0,
        "issues": issues,
        "stats": {"blind_bid": True},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--sections", required=True)
    args = ap.parse_args()
    res = run(args.tender, args.sections)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
