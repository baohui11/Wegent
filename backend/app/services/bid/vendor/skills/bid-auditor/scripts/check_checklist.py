#!/usr/bin/env python3
"""必备材料清单核对：招标要求的材料是否在资质库齐全、是否过期。"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from dates import parse_dt  # noqa: E402


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def run(tender_path, corpus_path):
    tender = load(tender_path)
    corpus = load(corpus_path)
    required = tender.get("submission_rules", {}).get("required_materials", [])
    deadline = parse_dt(tender.get("project", {}).get("bid_deadline"))
    items = corpus.get("items", [])
    ro = tender.get("required_outline") or {}
    _strip = re.compile(r"[\"'“”‘’「」『』（）()\s、]")

    def _norm(s):
        s = re.sub(r"（?格式自拟）?", "", s or "")
        return _strip.sub("", s)

    section_titles = {
        _norm(s.get("title", ""))
        for s in (ro.get("sections") or [])
        if isinstance(s, dict)
    }

    # 我方按格式自行编制/填写的文件（非资质库证照），精确短语、不含裸"表/书"，避免误跳真证照
    PRODUCED_DOC_KEYWORDS = [
        "偏差表",
        "响应表",
        "报价表",
        "报价明细",
        "明细报价",
        "开标一览",
        "投标函",
        "承诺函",
        "声明",
        "基本情况表",
        "技术文件",
        "商务文件",
        "价格文件",
        "投标文件",
        "响应索引",
        "目录",
    ]
    produced_norm = [_norm(k) for k in PRODUCED_DOC_KEYWORDS]
    joint_allowed = bool(tender.get("project", {}).get("joint_bid_allowed"))

    def _bigrams(s):
        s = _norm(s)
        return (
            {s[i : i + 2] for i in range(len(s) - 1)}
            if len(s) >= 2
            else ({s} if s else set())
        )

    def _word_overlap(a, b):
        ga = _bigrams(a)
        if not ga:
            return 0.0
        gb = _bigrams(b)
        return len(ga & gb) / len(ga)

    issues = []
    skipped = 0
    pending = 0
    for req in required:
        nreq = _norm(req)
        if "格式自拟" in req or nreq in section_titles:
            skipped += 1
            continue  # 要写的章节，不是要交的材料
        if "联合体" in req and not joint_allowed:
            skipped += 1  # 本项目不接受联合体，该项不适用
            continue
        if any(kw in nreq for kw in produced_norm):
            skipped += 1  # 我方按格式自行编制/填写的文件，非资质库证照
            continue

        core = _norm(req.replace("复印件", "").replace("证明", ""))
        # 片段匹配：req 按标点分段，每段 _norm 后≥3字且非纯数字开头
        frags = []
        for p in re.split(r"[（()）+，,。；;：:、\s]+", req or ""):
            pn = _norm(p)
            if len(pn) >= 3 and not pn[:4].isdigit():
                frags.append(pn)

        def _hit(it):
            names = [it.get("name", "")] + list(it.get("alias", []) or [])
            for nn in (_norm(n) for n in names):
                if not nn:
                    continue
                if (core[:4] and core[:4] in nn) or nn in core or core in nn:
                    return True
                if any(f in nn or nn in f for f in frags):
                    return True
                if _word_overlap(core, nn) >= 0.5:  # 词级重叠，缓解语序变形
                    return True
            return False

        match = next((it for it in items if _hit(it)), None)
        if not match:
            # 保守安全：未匹配降为 medium 提示（不假装齐全、也不因不确定卡废标）
            pending += 1
            issues.append(
                {
                    "desc": f"必备材料未在资质库找到对应条目：{req}（可能缺失或措辞差异，请人工核对）",
                    "severity": "medium",
                    "veto": False,
                    "material": req,
                }
            )
            continue
        exp = parse_dt(match.get("expiry"))
        if exp and deadline and exp < deadline:
            issues.append(
                {
                    "desc": f"材料「{match['name']}」已于 {match['expiry']} 过期，早于投标截止 {tender['project']['bid_deadline']}",
                    "severity": "high",
                    "veto": True,
                    "material": match["name"],
                }
            )

    return {
        "check": "checklist",
        "ok": len(issues) == 0,
        "stats": {
            "required": len(required),
            "corpus_items": len(items),
            "skipped": skipped,
            "pending_review": pending,
        },
        "issues": issues,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--corpus", required=True)
    args = ap.parse_args()
    res = run(args.tender, args.corpus)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
