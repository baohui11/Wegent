#!/usr/bin/env python3
"""把权威 tender.json 反拆成自洽的 tender_parts/*.json（merge_tender 的逆操作）。
保证往返：merge(split(tender)) ≡ tender。遇未映射顶层键即报错，绝不静默丢键。"""
import argparse
import json
from pathlib import Path

# 顶层键 → part 文件名（参照 tender-sleuth.md 的 8-part 拓扑）
KEY_TO_PART = {
    "_meta": "01_project",
    "project": "01_project",
    "package": "01_project",
    "qualifications": "01_project",
    "commitment_terms": "01_project",
    "target_package": "02_target_package",
    "scoring": "03_scoring",
    "scoring_detail": "03_scoring",
    "mandatory_clauses": "04_clauses",
    "required_outline": "05_required_outline",
    "requirements": "06_requirements",
    "derived_outline": "07_derived_outline",
    "bidder_outline_profile": "07_derived_outline",
    "bidder_knowledge_base": "07_derived_outline",
    "submission_rules": "08_submission",
    "writing_rules": "08_submission",
    "notes": "08_submission",
}


def split(tender):
    parts = {}
    for key, value in tender.items():
        part = KEY_TO_PART.get(key)
        if part is None:
            raise ValueError(
                f"split_tender：未映射的顶层键 {key!r}，请在 KEY_TO_PART 补充其归属 part（绝不静默丢键）"
            )
        parts.setdefault(part, {})[key] = value
    return parts


def run(tender_path, out_parts_dir):
    tender = json.loads(Path(tender_path).read_text(encoding="utf-8"))
    out = Path(out_parts_dir)
    out.mkdir(parents=True, exist_ok=True)
    parts = split(tender)
    for name, block in parts.items():
        (out / f"{name}.json").write_text(
            json.dumps(block, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return sorted(parts.keys())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", default="workspace/tender.json")
    ap.add_argument("--out-parts", default="workspace/tender_parts")
    args = ap.parse_args()
    names = run(args.tender, args.out_parts)
    print(json.dumps({"ok": True, "parts": names}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
