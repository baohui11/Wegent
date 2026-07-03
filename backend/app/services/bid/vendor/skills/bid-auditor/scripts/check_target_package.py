#!/usr/bin/env python3
"""分包锁定确定性闸门：校验 target_package 权重和=100、rubric 代号格式、
价格公式参数齐全、与 bid_config 声明的分包一致。锁错包/抽串细则 → 报警。"""
import argparse
import json
import re
import sys
from pathlib import Path

RUBRIC_RE = re.compile(r"^JS-[A-Za-z0-9]+$")


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def run(tender_path, bid_config_path=None):
    tender = load(tender_path)
    tp = tender.get("target_package")
    issues = []

    if not tp:
        return {
            "check": "target_package",
            "ok": False,
            "issues": [
                {
                    "desc": "tender.json 缺 target_package（分包未锁定，多套评分细则可能被全抽串味）",
                    "severity": "high",
                    "veto": False,
                }
            ],
        }

    w = tp.get("weights") or {}
    total = sum(w.get(k, 0) or 0 for k in ("tech", "commerce", "price"))
    if abs(total - 100) > 0.5:
        issues.append(
            {
                "desc": f"分包权重和(技{w.get('tech')}+商{w.get('commerce')}+价{w.get('price')})={total}≠100",
                "severity": "high",
                "veto": False,
            }
        )

    code = tp.get("tech_rubric_code") or ""
    if not RUBRIC_RE.match(code):
        issues.append(
            {
                "desc": f"技术评分细则代号异常：{code!r}（应形如 JS-XXX）",
                "severity": "high",
                "veto": False,
            }
        )

    if not tp.get("price_formula"):
        issues.append(
            {"desc": "价格公式 price_formula 缺失", "severity": "medium", "veto": False}
        )
    if tp.get("price_param_n") in (None, ""):
        issues.append(
            {
                "desc": "价格公式参数 price_param_n 缺失",
                "severity": "medium",
                "veto": False,
            }
        )

    if bid_config_path and Path(bid_config_path).exists():
        declared = (load(bid_config_path).get("target_package") or {}).get("分包")
        if declared and tp.get("分包") and declared != tp.get("分包"):
            issues.append(
                {
                    "desc": f"锁定分包与配置声明不一致：tender={tp.get('分包')} 配置={declared}（疑似锁错包）",
                    "severity": "high",
                    "veto": False,
                }
            )

    return {"check": "target_package", "ok": len(issues) == 0, "issues": issues}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--bid-config", default="corpus/bid_config.json")
    args = ap.parse_args()
    res = run(args.tender, args.bid_config)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
