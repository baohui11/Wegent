#!/usr/bin/env python3
"""起草出口·背书事实接地（确定性部分）。
扫正文裸背书事实（专利数/资本/CMMI/ISO/人数等）。若该句既无 {{qual:..}}/{{bidder}} 占位、
又在知识库 verified 素材里找不到出处 → 产出待核稿官裁判的 task。传入 verdicts 时折算成 issue。"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fidelity_io import load_verdicts, write_tasks

ENDORSEMENT_PATTERNS = [
    r"\d+\s*项(?:发明|实用新型)?专利",
    r"注册资本[^，。；\n]{0,10}?[\d.]+\s*[万亿]",
    r"(?:营收|营业收入|年产值)[^，。；\n]{0,10}?[\d.]+",
    r"CMMI\s*\d",
    r"ISO\s*\d{4,}",
    r"\d+\s*(?:名|位)(?:专职|专业|技术|全职)?(?:高级|资深|首席|中级|副高|正高|核心|骨干)?(?:人员|工程师|专家|技师|职称|顾问)",
]
PLACEHOLDER_RE = re.compile(r"\{\{(?:qual:[A-Za-z0-9_]+|bidder)\}\}")
SENT_SPLIT = re.compile(r"[。；\n]")


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def _norm(s):
    return re.sub(r"\s+", "", s or "")


def _kb_verified_text(kb):
    root = kb.get("bidder_knowledge_base", kb)
    buf = []
    for items in root.values():
        seq = items.values() if isinstance(items, dict) else (items or [])
        for it in seq:
            if isinstance(it, dict) and it.get("verification_status") == "verified":
                buf.append(json.dumps(it, ensure_ascii=False))
    return _norm("\n".join(buf))


def run(sections_dir, kb_path, verdicts=None):
    sections_dir = Path(sections_dir)
    kb = load(kb_path) if Path(kb_path).exists() else {}
    kb_text = _kb_verified_text(kb)
    verdicts = verdicts or {}

    issues, tasks, seq = [], [], 0
    for f in sorted(sections_dir.glob("*.md")):
        for sent in SENT_SPLIT.split(f.read_text(encoding="utf-8")):
            sent = sent.strip()
            if not sent:
                continue
            matched = [
                m.group(0)
                for pat in ENDORSEMENT_PATTERNS
                for m in re.finditer(pat, sent)
            ]
            if not matched or PLACEHOLDER_RE.search(sent):
                continue
            fact = matched[0]
            if _norm(fact) in kb_text:
                continue  # 知识库 verified 素材里能找到出处
            tid = f"EG-{seq:03d}"
            seq += 1
            v = verdicts.get(tid)
            if v is None:
                tasks.append(
                    {
                        "id": tid,
                        "type": "endorsement_grounding",
                        "claim": sent,
                        "candidate_sources": [{"ref": f.stem, "text": fact}],
                        "context": f"section {f.stem}",
                    }
                )
            elif v.get("verdict") in ("fabricated", "unfaithful"):
                issues.append(
                    {
                        "desc": f"背书事实疑似编造（{f.stem}）：{sent[:50]}（核稿官：{v.get('reason', '')}）",
                        "severity": "high",
                        "veto": False,
                        "section_id": f.stem,
                    }
                )
            elif v.get("verdict") == "uncertain":
                issues.append(
                    {
                        "desc": f"背书事实出处存疑（{f.stem}）：{sent[:50]}",
                        "severity": "medium",
                        "veto": False,
                        "section_id": f.stem,
                    }
                )

    return {
        "check": "endorsement_grounding",
        "ok": len(issues) == 0,
        "stats": {"pending_tasks": len(tasks)},
        "issues": issues,
        "tasks": tasks,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", required=True)
    ap.add_argument("--knowledge-base", default="corpus/bidder_knowledge_base.json")
    ap.add_argument("--tasks-out", default="workspace/_fidelity_tasks_section.json")
    ap.add_argument("--verdicts", nargs="*", default=[])
    args = ap.parse_args()
    res = run(args.sections, args.knowledge_base, load_verdicts(args.verdicts))
    write_tasks(args.tasks_out, "section_draft", res["tasks"])
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
