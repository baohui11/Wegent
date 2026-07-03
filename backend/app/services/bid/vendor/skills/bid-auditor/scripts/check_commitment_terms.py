#!/usr/bin/env python3
"""校验服务承诺数值口径一致性。"""
import argparse
import json
import re
import sys
from pathlib import Path

STAFF_REPLACEMENT_KEYWORD_RE = re.compile(r"(?:人员更换|更换人员|替换人员)")
STAFF_REPLACEMENT_NOTICE_RE = re.compile(r"提前\s*(\d+)\s*个工作日")

TERM_RULES = {
    "staff_replacement_days": {
        "label": "人员更换提前期",
        "unit": "个工作日",
        "pattern": None,
        "tender_keys": (
            "staff_replacement_notice_days",
            "staff_replacement_days",
            "personnel_replacement_days",
            "personnel_replacement_workdays",
        ),
    },
    "response_hours": {
        "label": "响应时限",
        "unit": "小时",
        "pattern": re.compile(
            r"(?:响应|服务响应|应急响应)[^。；;\n]{0,20}?(\d+)\s*小时"
        ),
        "tender_keys": (
            "response_hours",
            "service_response_hours",
            "emergency_response_hours",
        ),
    },
    "after_sales_months": {
        "label": "售后期限",
        "unit": "个月",
        "pattern": re.compile(r"售后[^。；;\n]{0,20}?(\d+)\s*个月"),
        "tender_keys": (
            "after_service_months",
            "after_sales_months",
            "after_sales_service_months",
            "warranty_months",
        ),
    },
}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def expected_number(commitment_terms, keys):
    for key in keys:
        value = commitment_terms.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str):
            match = re.search(r"\d+", value)
            if match:
                return int(match.group(0))
    return None


def iter_short_clauses(text):
    for clause in re.split(r"[。；;\n]", text):
        clause = clause.strip()
        if clause:
            yield clause


def scan_staff_replacement_notice(text):
    values = []
    for clause in iter_short_clauses(text):
        if not STAFF_REPLACEMENT_KEYWORD_RE.search(clause):
            continue
        for match in STAFF_REPLACEMENT_NOTICE_RE.finditer(clause):
            values.append(int(match.group(1)))
    return values


def scan_sections(sections_dir):
    hits = {name: [] for name in TERM_RULES}
    for path in sorted(Path(sections_dir).glob("*.md")):
        text = path.read_text(encoding="utf-8")
        for name, rule in TERM_RULES.items():
            if name == "staff_replacement_days":
                for value in scan_staff_replacement_notice(text):
                    hits[name].append({"value": value, "file": path.name})
                continue
            for match in rule["pattern"].finditer(text):
                hits[name].append({"value": int(match.group(1)), "file": path.name})
    return hits


def run(tender_path, sections_dir):
    tender = load(tender_path)
    commitment_terms = tender.get("commitment_terms", {})
    hits = scan_sections(sections_dir)
    issues = []
    if not isinstance(commitment_terms, dict):
        # 崩溃保护：拆标产出非 dict（如条款 list）不崩，报结构提示并跳过数值校验
        issues.append(
            {
                "desc": "commitment_terms 结构非字典（应为 dict：数值/口径字段 + 可选 clauses 数组），"
                "请回拆标规范；本次跳过数值口径校验",
                "severity": "medium",
                "veto": False,
                "term": "commitment_terms",
            }
        )
        commitment_terms = {}

    for name, rule in TERM_RULES.items():
        values = sorted({hit["value"] for hit in hits[name]})
        if len(values) > 1:
            issues.append(
                {
                    "desc": f"{rule['label']}出现多个口径：{values} {rule['unit']}",
                    "severity": "medium",
                    "veto": False,
                    "term": name,
                }
            )

        expected = expected_number(commitment_terms, rule["tender_keys"])
        if expected is not None:
            bad_values = [value for value in values if value != expected]
            if bad_values:
                issues.append(
                    {
                        "desc": f"{rule['label']} commitment_terms 不一致：正文口径 {bad_values} {rule['unit']}，要求 {expected} {rule['unit']}",
                        "severity": "medium",
                        "veto": False,
                        "term": name,
                    }
                )

    return {"check": "commitment_terms", "ok": len(issues) == 0, "issues": issues}


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
