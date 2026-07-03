#!/usr/bin/env python3
"""结构化区块点数员：评分权重和=100 / 目录章号连续 / 锚点整区 closed_by /
别处引用章号印证。拿不准只报「请人工确认」，绝不静默放行，也不假装知道绝对答案。"""
import argparse
import json
import re
import sys
from pathlib import Path

CN = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}
MIN_SECTIONS = 3
REF_RE = re.compile(r"第\s*([一二三四五六七八九十\d]+)\s*章")


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def _cn_to_int(s):
    s = (s or "").strip().strip("、.． ")
    if s.isdigit():
        return int(s)
    return CN.get(s)


def run(tender_path, manifest_path):
    tender = load(tender_path)
    manifest = (
        load(manifest_path) if manifest_path and Path(manifest_path).exists() else {}
    )
    issues = []

    # 1. 权重和=100：有 category 时只校验技术类别；无 category 时回退全量。
    scoring = tender.get("scoring", [])
    if scoring:
        has_category = any(s.get("category") for s in scoring)
        pool = (
            [s for s in scoring if s.get("category") == "技术"]
            if has_category
            else scoring
        )
        if pool:
            ids = [s.get("id") for s in pool if s.get("id")]

            def _is_parent(sid):
                return bool(sid) and any(
                    o != sid and o.startswith(sid + "-") for o in ids
                )

            total = sum(
                s.get("weight", 0) or 0 for s in pool if not _is_parent(s.get("id", ""))
            )
            label = "技术评分" if has_category else "评分"
            if total and abs(total - 100) > 0.5:
                issues.append(
                    {
                        "desc": f"{label}叶子项权重和={total}≠100，评分表疑似被截断/漏抽",
                        "severity": "high",
                        "veto": False,
                    }
                )

    outline = tender.get("required_outline") or {}
    sections = outline.get("sections", []) if isinstance(outline, dict) else []
    nums = [n for n in (_cn_to_int(s.get("no")) for s in sections) if n]

    # 2. 章号连续性（抓中间漏）
    if nums:
        expected = list(range(1, max(nums) + 1))
        missing = sorted(set(expected) - set(nums))
        if missing:
            issues.append(
                {
                    "desc": f"技术文件目录章号不连续，疑似缺失第 {missing} 章",
                    "severity": "high",
                    "veto": False,
                }
            )

    # 3. 锚点整区 closed_by（抓尾巴被自己切断）
    for reg in manifest.get("regions", []):
        if (
            reg.get("block") == "required_outline"
            and reg.get("closed_by") == "size_limit"
        ):
            issues.append(
                {
                    "desc": "技术文件目录整区疑似被截断（closed_by=size_limit），请人工确认完整性",
                    "severity": "medium",
                    "veto": False,
                }
            )

    # 6. 结构化整区整体缺失（锚点失败）→ 亮人工灯，绝不静默
    if "regions" in manifest:
        present = {r.get("block") for r in manifest.get("regions", [])}
        if "required_outline" not in present:
            issues.append(
                {
                    "desc": "技术文件目录锚点整区未召回（manifest.regions 无 required_outline），"
                    "无法确认目录完整性，请人工确认或拓宽锚点配置",
                    "severity": "medium",
                    "veto": False,
                }
            )

    # 4. 别处引用印证（抓尾巴被切断的另一信号）
    if nums:
        mx = max(nums)
        blob = (
            " ".join(str(s.get("item", "")) for s in scoring)
            + " "
            + " ".join(str(r.get("text", "")) for r in tender.get("requirements", []))
        )
        for m in REF_RE.finditer(blob):
            ref = _cn_to_int(m.group(1))
            if ref and ref > mx:
                issues.append(
                    {
                        "desc": f"正文/评分引用了第{ref}章，超出目录最大章号{mx}，目录疑似缺失",
                        "severity": "high",
                        "veto": False,
                    }
                )
                break

    # 5. 合理性下限 + 拿不准亮人工灯
    if sections and len(sections) < MIN_SECTIONS and not outline.get("fallback_used"):
        issues.append(
            {
                "desc": f"技术文件目录仅 {len(sections)} 节，异常偏短，请人工确认是否被截断",
                "severity": "medium",
                "veto": False,
            }
        )

    return {
        "check": "structured_completeness",
        "ok": len(issues) == 0,
        "issues": issues,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--manifest", default="workspace/tender_manifest.json")
    args = ap.parse_args()
    res = run(args.tender, args.manifest)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
