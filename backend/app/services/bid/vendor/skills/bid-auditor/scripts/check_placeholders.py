#!/usr/bin/env python3
"""最终稿残留占位符扫描：交付前正文不得出现任何 {{...}}（说明占位符没被知识库替换）。"""
import argparse
import json
import re
import sys
from pathlib import Path

RESIDUAL_RE = re.compile(r"\{\{[^}]*\}\}")


def run(sections_dir):
    issues = []
    for f in sorted(Path(sections_dir).glob("*.md")):
        for ln, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            for m in RESIDUAL_RE.finditer(line):
                issues.append(
                    {
                        "desc": f"{f.name}:{ln} 残留未替换占位符 {m.group(0)}（交付前必须由 resolve_quals 用知识库替换）",
                        "severity": "high",
                        "veto": False,
                        "file": f.name,
                        "line": ln,
                    }
                )
    return {"check": "placeholders", "ok": len(issues) == 0, "issues": issues}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", required=True)
    a = ap.parse_args()
    res = run(a.sections)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
