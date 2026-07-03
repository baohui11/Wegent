#!/usr/bin/env python3
"""拆标出口·上游保真闸门（确定性部分）。
对每条 mandatory_clause 做原文接地：接得上→放行；接不上→产出待核稿官裁判的 task。
另做红线召回：原文含否决关键词却无任何条款覆盖的行→中危 issue。
传入 verdicts 时，把已裁判的 task 折算成 issue。"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fidelity_io import load_verdicts, write_tasks

VETO_KEYWORDS = [
    "★",
    "▲",
    "否决",
    "无效",
    "不予",
    "不接受",
    "实质性",
    "最高限价",
    "废标",
    "拒收",
]
# 强否决词（VETO_KEYWORDS 去「实质性」）：仅靠「实质性」弱命中、无强词的行视为噪声
STRONG_VETO = [k for k in VETO_KEYWORDS if k != "实质性"]
# 多列表头列名：行含 ≥2 个 | 且含下列列名 → 表头噪声
TABLE_HEADER_COLS = [
    "序号",
    "评审内容",
    "否决情形",
    "否决事项",
    "分标编号",
    "分标名称",
    "最高限价",
    "价格公式",
    "权重比例",
    "参数选择",
]
GROUND_THRESHOLD = 0.6  # clause.desc 与原文的 bigram 重合比 ≥ 此值视为已接地
RECALL_THRESHOLD = 0.5  # 原文红线行与某条款的重合比 ≥ 此值视为已被覆盖
CLUSTER_THRESHOLD = 0.7  # 召回候选行 bigram 重合 ≥ 此值视为同一簇


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def _norm(s):
    return re.sub(r"\s+", "", s or "")


def _bigrams(s):
    s = _norm(s)
    if len(s) < 2:
        return {s} if s else set()
    return {s[i : i + 2] for i in range(len(s) - 1)}


def _overlap(a, b):
    """a 的 bigram 有多少比例出现在 b 中。"""
    ga = _bigrams(a)
    if not ga:
        return 0.0
    nb = _norm(b)
    return sum(1 for g in ga if g in nb) / len(ga)


def _read_sources(sources_dir):
    sources_dir = Path(sources_dir)
    if sources_dir.is_file():
        return sources_dir.read_text(encoding="utf-8")
    if not sources_dir.exists():
        return ""
    return "\n".join(
        f.read_text(encoding="utf-8") for f in sorted(sources_dir.glob("*.txt"))
    )


def _best_line(desc, lines):
    best, score = "", 0.0
    for ln in lines:
        s = _overlap(desc, ln)
        if s > score:
            best, score = ln, s
    return best


# 召回降噪：纯表头/小标题行、反向句、被 clause 完整包含的行不计簇（只降噪，不碰红线抽取）
RECALL_HEADER_RE = re.compile(
    r"^(?:序号|[一二三四五六七八九十百]+、|（[一二三四五六七八九十]+）|\d+[\.、])\s*\S{0,10}$"
)
RECALL_FALSE_RE = re.compile(
    r"不予退还|并不否决|评标委员会成员|内部.{0,4}规则|"
    r"如下表所示|见下表|详见.{0,6}公告|有以下情形之一|有一项不符合|其他否决情形|"
    r"规定的其他|其他条款|以.{0,8}为准|不改变.{0,6}实质性内容|构成.{0,6}组成部分|"
    r"迟到的回复|逾期.{0,4}回复"
)


CONTAINED_THRESHOLD = (
    0.8  # 命中行 bigram 有 ≥80% 落在某 clause.desc → 视为已被覆盖（标点鲁棒）
)


def _is_table_header(ln):
    return ln.count("|") >= 2 and any(col in ln for col in TABLE_HEADER_COLS)


def _is_recall_noise(ln, clauses):
    if RECALL_HEADER_RE.match(ln):
        return True
    if _is_table_header(ln):
        return True
    if RECALL_FALSE_RE.search(ln):
        return True
    if not any(k in ln for k in STRONG_VETO):  # 仅「实质性」弱命中、无强否决词
        return True
    return any(_overlap(ln, m.get("desc", "")) >= CONTAINED_THRESHOLD for m in clauses)


def run(tender_path, sources_dir, verdicts=None):
    tender = load(tender_path)
    text = _read_sources(sources_dir)
    verdicts = verdicts or {}
    clauses = tender.get("mandatory_clauses", [])

    if not text.strip():
        return {
            "check": "source_fidelity",
            "ok": True,
            "stats": {
                "clauses": len(clauses),
                "grounded": 0,
                "pending_tasks": 0,
                "recall_gaps": 0,
                "skipped": "无招标原文，跳过",
            },
            "issues": [],
            "tasks": [],
        }

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    issues, tasks, grounded = [], [], 0

    for idx, m in enumerate(clauses):
        desc = m.get("desc", "")
        if _overlap(desc, text) >= GROUND_THRESHOLD:
            grounded += 1
            continue
        tid = f"SF-{idx:03d}"
        v = verdicts.get(tid)
        if v is None:
            tasks.append(
                {
                    "id": tid,
                    "type": "clause_faithfulness",
                    "claim": desc,
                    "candidate_sources": [
                        {"ref": m.get("id", f"M{idx}"), "text": _best_line(desc, lines)}
                    ],
                    "context": f"mandatory_clause {m.get('id')}",
                }
            )
        elif v.get("verdict") in ("unfaithful", "fabricated"):
            issues.append(
                {
                    "desc": f"红线条款 {m.get('id')} 与原文不符（核稿官：{v.get('reason', '')}）",
                    "severity": "high",
                    "veto": True,
                    "clause_id": m.get("id"),
                }
            )
        elif v.get("verdict") == "uncertain":
            issues.append(
                {
                    "desc": f"红线条款 {m.get('id')} 原文接地存疑，建议人工复核",
                    "severity": "medium",
                    "veto": False,
                    "clause_id": m.get("id"),
                }
            )
        else:  # faithful
            grounded += 1

    # 红线召回：先按相似度聚簇，同类红线行归一，stats 反映簇数而非原始行数。
    clusters = []
    for ln in lines:
        if not any(kw in ln for kw in VETO_KEYWORDS):
            continue
        if _is_recall_noise(ln, clauses):
            continue
        best = max((_overlap(m.get("desc", ""), ln) for m in clauses), default=0.0)
        if best >= RECALL_THRESHOLD:
            continue
        if any(_overlap(ln, rep) >= CLUSTER_THRESHOLD for rep in clusters):
            continue
        clusters.append(ln.strip())
    recall_gaps = len(clusters)
    if clusters:
        sample = "；".join(c[:40] for c in clusters[:3])
        issues.append(
            {
                "desc": f"原文 {recall_gaps} 类红线行（约 {recall_gaps} 处）疑似漏抽（无对应 mandatory_clause），样例：{sample}",
                "severity": "medium",
                "veto": False,
            }
        )

    return {
        "check": "source_fidelity",
        "ok": len(issues) == 0,
        "stats": {
            "clauses": len(clauses),
            "grounded": grounded,
            "pending_tasks": len(tasks),
            "recall_gaps": recall_gaps,
        },
        "issues": issues,
        "tasks": tasks,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--inputs", required=True, help="招标原文目录或单文件")
    ap.add_argument("--tasks-out", default="workspace/_fidelity_tasks.json")
    ap.add_argument("--verdicts", nargs="*", default=[])
    args = ap.parse_args()
    res = run(args.tender, args.inputs, load_verdicts(args.verdicts))
    write_tasks(args.tasks_out, "tender_parse", res["tasks"])
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
