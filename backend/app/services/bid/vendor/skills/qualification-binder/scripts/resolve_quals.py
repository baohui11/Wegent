#!/usr/bin/env python3
"""占位符解析/绑定：用知识库把 {{bidder}} 与 {{qual:ID}} 替换成最终稿，并生成附件清单。

替换规则：
- {{bidder}}  -> 暗标(blind_bid=true)时替换为"我方"（防泄密）；非暗标替换为投标人公司名
- {{qual:ID}} -> "（见附件N）"，N 按首次出现顺序自动编号；同一 ID 复用同一附件号

失败（退出码 1）：引用了知识库不存在的 ID、引用了已过期资质、{{bidder}} 但缺公司名、
或替换后仍残留任何 {{...}}。这一步是"占位符必须落到真实知识库"的硬闸门。
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from dates import parse_dt  # noqa: E402

QUAL_RE = re.compile(r"\{\{qual:([A-Za-z0-9_]+)\}\}")
BIDDER_RE = re.compile(r"\{\{bidder\}\}")
RESIDUAL_RE = re.compile(r"\{\{[^}]*\}\}")


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def run(sections_dir, corpus_path, tender_path, out_dir, attach_path):
    corpus = load(corpus_path)
    tender = load(tender_path)
    items = {it["id"]: it for it in corpus.get("items", [])}
    company = corpus.get("company")
    blind = tender.get("submission_rules", {}).get("blind_bid", False)
    deadline = parse_dt(tender.get("project", {}).get("bid_deadline"))
    bidder_render = "我方" if blind else (company or "")

    issues = []
    if not blind and not company:
        issues.append("非暗标但资质库缺少 company 字段，{{bidder}} 无法替换")

    # 第一遍：按文件名排序 + 文件内出现顺序，给每个被引用资质分配附件号
    files = sorted(Path(sections_dir).glob("*.md"))
    order = []
    for f in files:
        for m in QUAL_RE.finditer(f.read_text(encoding="utf-8")):
            if m.group(1) not in order:
                order.append(m.group(1))
    attach_no = {qid: i + 1 for i, qid in enumerate(order)}

    # 校验引用合法性 + 有效期
    for qid in order:
        if qid not in items:
            issues.append(f"引用了知识库不存在的资质占位符 {{{{qual:{qid}}}}}")
        else:
            exp = parse_dt(items[qid].get("expiry"))
            if exp and deadline and exp < deadline:
                issues.append(
                    f"引用的资质「{items[qid]['name']}」已于 {items[qid]['expiry']} 过期，不可引用"
                )

    if issues:
        print(
            json.dumps(
                {"ok": False, "stage": "校验", "issues": issues},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1

    # 第二遍：替换并写最终稿
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    residual = []
    for f in files:
        t = f.read_text(encoding="utf-8")
        t = BIDDER_RE.sub(bidder_render, t)
        t = QUAL_RE.sub(lambda m: f"（见附件{attach_no[m.group(1)]}）", t)
        for rm in RESIDUAL_RE.finditer(t):
            residual.append(f"{f.name}: 替换后仍残留 {rm.group(0)}")
        (out / f.name).write_text(t, encoding="utf-8")

    # 生成附件清单（人读 .md + 机读 .json，供装订脚本插图）
    lines = [
        "# 附件清单（资质/材料）",
        "",
        "> 正文中以「（见附件N）」交叉引用；装订时将下列材料截图按序插入投标文件末尾。",
        "",
        "| 附件 | 材料名称 | 文件 |",
        "|---|---|---|",
    ]
    manifest = []
    for qid in order:
        it = items[qid]
        lines.append(f"| 附件{attach_no[qid]} | {it['name']} | {it.get('file', '')} |")
        manifest.append(
            {
                "no": attach_no[qid],
                "id": qid,
                "name": it["name"],
                "file": it.get("file", ""),
            }
        )
    Path(attach_path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    json_path = Path(attach_path).with_suffix(".json")
    json_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if residual:
        print(
            json.dumps(
                {"ok": False, "stage": "替换", "issues": residual},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "blind_bid": blind,
                "bidder_render": bidder_render,
                "attachments": [
                    {"no": attach_no[q], "id": q, "name": items[q]["name"]}
                    for q in order
                ],
                "out_dir": str(out),
                "attachments_file": attach_path,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--tender", required=True)
    ap.add_argument("--out-sections", required=True)
    ap.add_argument("--attachments", required=True)
    a = ap.parse_args()
    sys.exit(run(a.sections, a.corpus, a.tender, a.out_sections, a.attachments))


if __name__ == "__main__":
    main()
