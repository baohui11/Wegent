#!/usr/bin/env python3
"""资质占位符校验：{{qual:ID}} 是否绑定真实资质、是否过期。"""
import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PH_RE = re.compile(r"\{\{qual:([A-Za-z0-9_]+)\}\}")
CST = timezone(timedelta(hours=8))


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def parse_dt(s):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        dt = datetime.fromisoformat(s + "T00:00:00")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=CST)
    return dt


def run(sections_dir, corpus_path, tender_path):
    corpus = {it["id"]: it for it in load(corpus_path).get("items", [])}
    deadline = parse_dt(load(tender_path).get("project", {}).get("bid_deadline"))
    issues = []
    used = set()
    for f in sorted(Path(sections_dir).glob("*.md")):
        text = f.read_text(encoding="utf-8")
        for m in PH_RE.finditer(text):
            qid = m.group(1)
            used.add(qid)
            if qid not in corpus:
                issues.append(
                    {
                        "desc": f"{f.name} 引用了不存在的资质占位符 {{{{qual:{qid}}}}}",
                        "severity": "high",
                        "veto": False,
                    }
                )
                continue
            exp = parse_dt(corpus[qid].get("expiry"))
            if exp and deadline and exp < deadline:
                issues.append(
                    {
                        "desc": f"{f.name} 引用的资质 {corpus[qid]['name']} 已过期（{corpus[qid]['expiry']}）",
                        "severity": "high",
                        "veto": True,
                    }
                )
    return {"ok": len(issues) == 0, "used": sorted(used), "issues": issues}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--tender", required=True)
    args = ap.parse_args()
    res = run(args.sections, args.corpus, args.tender)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
