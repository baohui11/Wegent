#!/usr/bin/env python3
"""聚合四项确定性校验，生成 workspace/audit_report.json 与终端体检报告。
退出码：有 veto → 2；有 high 无 veto → 1；全过 → 0。"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import check_checklist
import check_commitment_terms
import check_coverage
import check_endorsement_grounding
import check_knowledge_base
import check_numbers
import check_outline_quality
import check_placeholders
import check_source_fidelity
import check_structured_completeness
import check_style
import check_target_package
import scan_blind
from fidelity_io import load_verdicts, write_tasks


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument("--outline", required=True)
    ap.add_argument("--sections", required=True)
    ap.add_argument("--pricing", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument(
        "--knowledge-base", required=False, default="corpus/bidder_knowledge_base.json"
    )
    ap.add_argument(
        "--final",
        required=False,
        default=None,
        help="最终稿目录（resolve_quals 的产物）；提供则额外做残留占位符检查",
    )
    ap.add_argument(
        "--inputs", default="inputs", help="招标原文目录/文件，供上游保真接地"
    )
    ap.add_argument(
        "--tasks-out",
        default="workspace/_fidelity_tasks.json",
        help="保真待裁判清单输出路径，供核稿官读取",
    )
    ap.add_argument(
        "--verdicts",
        nargs="*",
        default=[],
        help="核稿官产出的 verdict 分片；传入则把已裁判项折算成 issue",
    )
    ap.add_argument(
        "--manifest",
        default="workspace/tender_manifest.json",
        help="segment_tender 产出的 manifest，供结构化完整性点数员判 closed_by",
    )
    ap.add_argument(
        "--bid-config",
        default="corpus/bid_config.json",
        help="投标人分包声明，供分包锁定闸门校验一致性",
    )
    args = ap.parse_args()

    # 把投标人名称塞进 tender 供暗标扫描（来自资质库）
    tender = load(args.tender)
    corpus = load(args.corpus)
    tender.setdefault("submission_rules", {})["_bidder_name"] = corpus.get("company")
    tmp_tender = Path(args.out).parent / "_tender_with_bidder.json"
    tmp_tender.write_text(json.dumps(tender, ensure_ascii=False), encoding="utf-8")

    verdicts = load_verdicts(args.verdicts)
    source_fidelity = check_source_fidelity.run(args.tender, args.inputs, verdicts)
    endorsement = check_endorsement_grounding.run(
        args.sections, args.knowledge_base, verdicts
    )
    pending_tasks = source_fidelity["tasks"] + endorsement["tasks"]
    write_tasks(args.tasks_out, "audit", pending_tasks)

    checks = [
        check_outline_quality.run(args.tender, args.outline),
        check_coverage.run(args.tender, args.outline, args.sections),
        check_numbers.run(args.pricing, args.sections),
        scan_blind.run(str(tmp_tender), args.sections),
        check_checklist.run(args.tender, args.corpus),
        check_style.run(args.sections),
        check_commitment_terms.run(args.tender, args.sections),
        source_fidelity,
        endorsement,
        check_structured_completeness.run(args.tender, args.manifest),
        check_target_package.run(args.tender, args.bid_config),
    ]
    if Path(args.knowledge_base).exists():
        checks.append(check_knowledge_base.run(args.outline, args.knowledge_base))
    if args.final:
        checks.append(check_placeholders.run(args.final))
    tmp_tender.unlink(missing_ok=True)

    all_issues = [i for c in checks for i in c["issues"]]
    veto = [i for i in all_issues if i.get("veto")]
    high = [i for i in all_issues if i.get("severity") == "high" and not i.get("veto")]

    verdict = "PASS" if not all_issues else ("NEED_FIX_VETO" if veto else "NEED_FIX")
    scoring = next(c for c in checks if c["check"] == "coverage")["stats"]

    report = {
        "verdict": verdict,
        "summary": {
            "total_issues": len(all_issues),
            "veto_issues": len(veto),
            "high_issues": len(high),
            "scoring_coverage": f"{scoring['scoring_covered']}/{scoring['scoring_total']}",
        },
        "checks": checks,
    }
    Path(args.out).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 终端体检报告
    icon = {"PASS": "✅", "NEED_FIX": "⚠️", "NEED_FIX_VETO": "⛔"}[verdict]
    print(f"\n{icon} 标书体检结论：{verdict}")
    print(
        f"   评分项覆盖：{report['summary']['scoring_coverage']}  "
        f"问题 {len(all_issues)} 项（其中废标级 {len(veto)}，高危 {len(high)}）\n"
    )
    for c in checks:
        flag = "ok" if c["ok"] else f"{len(c['issues'])} 项问题"
        print(f"  [{c['check']}] {flag}")
        for i in c["issues"]:
            tag = (
                "⛔废标"
                if i.get("veto")
                else ("●高" if i["severity"] == "high" else "·中")
            )
            print(f"     {tag} {i['desc']}")
    if pending_tasks:
        print(f"\n🔎 待核稿官裁判 {len(pending_tasks)} 项 → 已写入 {args.tasks_out}")
        print("   操盘手下一步：并行派 @核稿官 裁判，再带 --verdicts 复跑本脚本。")
    print(f"\n报告已写入：{args.out}")

    sys.exit(2 if veto else (1 if high else 0))


if __name__ == "__main__":
    main()
