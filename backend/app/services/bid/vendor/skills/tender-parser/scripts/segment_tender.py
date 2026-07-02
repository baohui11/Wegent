#!/usr/bin/env python3
"""输入端预切分（确定性）。不依赖正则切分成功：标题正则只是首选断点 hint，
失败逐级降级到定长硬切，永不失败、永不产 0 段；切完覆盖自检保证不丢字。"""
import argparse
import json
import re
import sys
from pathlib import Path

TARGET = 32000  # 每段目标字符数（约 21K tokens）
MAX_CHARS = 40000  # 硬上限（约 26K tokens）
OVERLAP = 600  # 段间重叠，防红线骑切口被劈断
MAX_REGION = 60000  # 锚点整区上限
MIN_REGION = 200  # 整区小于此视为塌缩/TOC误命中，不作有效整区
CHAPTER_RE = re.compile(
    r"(?m)^[ \t]*第[一二三四五六七八九十百零\d]+章"
)  # 粗粒度章级边界

# 首选断点：章节标题行起始（多套并集）
HEADING_RE = re.compile(
    r"(?m)^[ \t]*(?:第[一二三四五六七八九十百零\d]+[章节]|"
    r"[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])"
)


def coverage_ok(segments, n):
    """覆盖自检：段按字符区间拼接必须无缝覆盖 [0, n)，允许重叠，不允许丢字/缺口。"""
    if not segments:
        return n == 0
    if segments[0][0] != 0 or segments[-1][1] != n:
        return False
    for (s, e), (_ps, pe) in zip(segments[1:], segments):
        if s > pe or e <= pe:  # 缺口 或 没有前进
            return False
    return True


def _best_break(text, lo, hi):
    """在 [lo, hi) 内找最佳断点：标题起始 > 双空行 > 单换行 > 句末 > 硬切(hi)。"""
    last_heading = None
    for m in HEADING_RE.finditer(text, lo, hi):
        last_heading = m.start()
    if last_heading is not None and last_heading > lo:
        return last_heading
    for sep in ("\n\n", "\n", "。", "；"):
        idx = text.rfind(sep, lo, hi)
        if idx != -1 and idx + len(sep) > lo:
            return idx + len(sep)
    return hi


def split_text(text, target=TARGET, max_chars=MAX_CHARS, overlap=OVERLAP):
    n = len(text)
    if n == 0:
        return []
    segments = []
    start = 0
    while start < n:
        if start + target >= n:
            end = n
        else:
            hard = min(start + max_chars, n)
            end = _best_break(text, start + target // 2, hard)
            if end <= start:  # 兜底：找不到任何断点就硬切
                end = hard
        segments.append((start, end))
        if end >= n:
            break
        start = end - overlap if end - overlap > start else end
    if not coverage_ok(segments, n):
        raise RuntimeError("覆盖自检失败：切分丢字或产生缺口，拒绝继续")
    return segments


def _region_from(text, s, all_anchors_map, max_region):
    """从位置 s 起算一个整区，边界=下一个其它锚点或下一个『第X章』（粗粒度，不被目录内部 一/（一）/1. 子标题误关）。"""
    flat = [a for anchors in all_anchors_map.values() for a in anchors]
    cand = []
    for a in flat:
        i = text.find(a, s + len(a))
        if i != -1 and i > s:
            cand.append(i)
    cm = CHAPTER_RE.search(text, s + 1)
    if cm is not None:
        cand.append(cm.start())
    if cand:
        b = min(cand)
        if b - s <= max_region:
            return s, b, "anchor"
        return s, s + max_region, "size_limit"
    if len(text) - s > max_region:
        return s, s + max_region, "size_limit"
    return s, len(text), "eof"


def extract_region(
    text, start_anchors, all_anchors_map, max_region=MAX_REGION, min_region=MIN_REGION
):
    """在所有 start_anchor 命中位置里选『产出整区最大』的那个（>= min_region）；全部塌缩则返回 None。
    这样自动跳过目录/TOC 里的误命中，落到正文实体章节；抽不出就交给点数员亮人工灯。"""
    occ = []
    for a in start_anchors:
        start = 0
        while True:
            i = text.find(a, start)
            if i == -1:
                break
            occ.append(i)
            start = i + len(a)
    if not occ:
        return None
    best = None  # (size, char_start, char_end, closed_by, anchor_pos)
    for s in sorted(set(occ)):
        rs, re_, closed = _region_from(text, s, all_anchors_map, max_region)
        size = re_ - rs
        if best is None or size > best[0]:
            best = (size, rs, re_, closed, s)
    if best is None or best[0] < min_region:
        return None
    _, rs, re_, closed, anchor_pos = best
    return {
        "char_start": rs,
        "char_end": re_,
        "closed_by": closed,
        "start_anchor": text[anchor_pos : anchor_pos + 8],
    }


def route_tags(segment_text, route_keywords):
    """段命中哪些区块路由词。一个都不中返回 []（unrouted，由 parser 兜底扫）。"""
    return [
        block
        for block, kws in route_keywords.items()
        if any(kw in segment_text for kw in kws)
    ]


def veto_candidates(text, veto_keywords, source_file):
    """跨全文逐行 grep 红线词，产出召回候选；与切分/路由解耦。"""
    out = []
    for ln_no, line in enumerate(text.splitlines(), 1):
        for kw in veto_keywords:
            if kw in line:
                out.append(
                    {
                        "keyword": kw,
                        "source_file": source_file,
                        "line_no": ln_no,
                        "text": line.strip()[:120],
                    }
                )
    return out


def _load_config(path):
    if path and Path(path).exists():
        return json.loads(Path(path).read_text(encoding="utf-8"))
    default = (
        Path(__file__).resolve().parents[2]
        / "tender-parser/references/segment_keywords.json"
    )
    return json.loads(default.read_text(encoding="utf-8"))


def run(inputs_dir, out_dir, config_path=None):
    cfg = _load_config(config_path)
    inputs_dir, out_dir = Path(inputs_dir), Path(out_dir)
    seg_dir = out_dir / "tender_segments"
    reg_dir = out_dir / "tender_regions"
    seg_dir.mkdir(parents=True, exist_ok=True)
    reg_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(inputs_dir.glob("*.txt"))
    manifest = {"segments": [], "regions": [], "coverage_ok": True}
    all_veto = []
    seg_no = 0
    for f in files:
        text = f.read_text(encoding="utf-8")
        all_veto += veto_candidates(text, cfg["veto_keywords"], f.name)
        for s, e in split_text(text):
            seg_text = text[s:e]
            tags = route_tags(seg_text, cfg["route_keywords"])
            sid = f"SEG-{seg_no:03d}"
            (seg_dir / f"{sid}.txt").write_text(seg_text, encoding="utf-8")
            manifest["segments"].append(
                {
                    "id": sid,
                    "source_file": f.name,
                    "char_start": s,
                    "char_end": e,
                    "route_tags": tags or ["unrouted"],
                }
            )
            seg_no += 1
        for block, anchors in cfg["region_anchors"].items():
            r = extract_region(text, anchors, cfg["region_anchors"])
            if r:
                rid = f"REG-{block}-{f.stem}"
                (reg_dir / f"{rid}.txt").write_text(
                    text[r["char_start"] : r["char_end"]], encoding="utf-8"
                )
                manifest["regions"].append(
                    {"id": rid, "block": block, "source_file": f.name, **r}
                )

    (out_dir / "veto_candidates.json").write_text(
        json.dumps({"candidates": all_veto}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "tender_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", default="inputs/final", help="已抽取招标正文目录")
    ap.add_argument("--out", default="workspace", help="产物输出目录")
    ap.add_argument(
        "--config", default=None, help="关键词覆盖配置（缺省用 references 默认）"
    )
    args = ap.parse_args()
    m = run(args.inputs, args.out, args.config)
    print(
        f"分段 {len(m['segments'])}，锚点整区 {len(m['regions'])}，"
        f"红线候选已写 {args.out}/veto_candidates.json"
    )


if __name__ == "__main__":
    main()
