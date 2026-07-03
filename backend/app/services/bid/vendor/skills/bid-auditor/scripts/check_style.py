#!/usr/bin/env python3
"""文风体检（确定性，对应 style-zhongda.md 风格圣经的自查阈值）。

只做客观、可量化的扫描，不做主观判断：
- 称谓违规：出现"采购方/本公司/我们/你们"（贵司/贵公司、我方/我司 均放行）   → high
- 标签矩阵：正文出现"原文要求：/我方响应：/如何满足："等当小标题            → high
- figure 裸泄漏：figure 规格字段(id/type/purpose/layout)出现在 ```figure 围栏之外 → high
- 自创辅助编号：正文/表格出现我方自创代号（里程碑 M1、承诺 CT01 等）         → high
- 引号自创方法名不足 / 以教科书名为主（PDCA/MBO/鱼骨图…当门面）            → medium
- 四字并列组数偏少                                                          → medium
- 正文被 bullet 列表主导（缺连贯标书段落）                                  → medium
- 多数正文段落缺三段式/骈偶要素                                             → medium
- 空词黑名单命中（赋能/抓手/闭环/生态…）                                    → medium
- 极致承诺数值不一致（如"提前 N 个工作日"出现多个 N）                        → medium

阈值集中在文件顶部，便于按项目调。文风问题不致废标，故 veto 一律 False。
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# ---- 可调阈值 ----
MIN_METHOD_NAMES = 10  # 引号自创方法名下限（校准：南网储能 v3 真实标书实测 11，留余量；n=1 我方过往非必中标）
MIN_PARALLEL_GROUPS = 50  # 全文四字并列组数下限（旧绝对阈值，已被密度模型取代）
PARALLEL_RATIO = 0.5  # 四字并列组/合格段 的密度下限（过半实义段骈偶）
MIN_PARAS_FOR_PARALLEL = 10  # 合格段少于此数则跳过密度判定（prose 太少不评判）
MAX_LABEL_MATRIX = 2  # 正文响应标签行数，超过即判"矩阵化"
PARA_QUALITY_RATIO = 0.12  # 三段式/骈偶段占比下限（校准：真实标书实测 0.13，取其下留余量；旧 0.5 严重偏离实践致误报）
PARA_MIN_HAN = 40  # 视为"正文段落"的最少汉字数

# ---- 词库与正则 ----
HAN = r"\u4e00-\u9fff"
# ≥3 个四字短语以顿号并列
PARALLEL_RE = re.compile(rf"(?:[{HAN}]{{4}}、){{2,}}[{HAN}]{{4}}")
# 引号内、以方法学后缀结尾的命名
QUOTED_RE = re.compile(r"[「“\"]([^」”\"\n]{2,20})[」”\"]")
METHOD_SUFFIX = ("法", "机制", "模式", "体系", "模型", "方法", "路径", "工程")
# 教科书通用方法名（当门面会被点名）
TEXTBOOK = [
    "PDCA",
    "MBO",
    "WBS",
    "SWOT",
    "KPI",
    "OKR",
    "SMART",
    "5W2H",
    "鱼骨图",
    "德尔菲",
    "甘特",
    "波特五力",
    "Gap Analysis",
    "PEST",
    "头脑风暴",
]
# 响应标签（应改写为连贯段落，不做小标题）
LABEL_RE = re.compile(
    r"^\s*(原文要求|我方响应|如何满足|具体做法|采用方法|使用工具|"
    r"时序安排|证明材料|是否偏离|偏离情况|我方理解)\s*[:：]"
)
# bullet / 编号行
BULLET_RE = re.compile(
    rf"^\s*(?:[-*•·]|\d+[.、)）]|[一二三四五六七八九十]+[、.)）])\s+"
)
# 称谓违规（甲方/乙方 常见于引用招标原文，故不纳入；贵司/贵公司、我方/我司 列为 house voice 放行）
BAD_ADDRESS = ["采购方", "本公司", "我们", "你们"]
# 空词硬黑名单（任一次出现即报）；闭环/抓手 因咨询/国企语境实义高频，已分诊移出为软词；"维度"亦早剔除
BLACKLIST = [
    "赋能",
    "生态",
    "链路",
    "全方位",
    "深度融合",
    "保驾护航",
    "强强联合",
    "量身打造",
    "一站式",
    "护城河",
    "底层逻辑",
]
# 软词：咨询实义、单节偏用容忍；单节出现 > 阈值视为刷屏（治国产模型 buzzword 堆砌）
SOFT_BLACKLIST = ["闭环", "抓手"]
SOFT_BLACKLIST_MAX = 3
# 配图维度：方案/架构/方法类小节应配 ```figure 规格块，缺则提示（medium，文风不致废标）
FIGURE_EXPECTED_KEYWORDS = [
    "方案",
    "架构",
    "设计",
    "实施",
    "路径",
    "方法",
    "机制",
    "蓝图",
    "流程",
    "框架",
    "模型",
    "技术路线",
    "步骤",
]
# figure 字段裸泄漏（用不易与正文重合的键）
FIG_LEAK_RE = re.compile(r"^\s*(id|type|purpose|layout)\s*[:：]\s*\S", re.I)
# 正文回显需求/评分 ID 或照抄原文（机械开头「针对评分项 SX：」、需求 ID「针对 R0/（R0/（S0」）。
# 表格行/标题行已先行豁免（偏离表、索引表里引用 ID 是正确的）。
ECHO_RE = re.compile(r"针对评分项|针对\s*[RST]\d|[（(][RST]\d")
# 我方自创的辅助编号代号：里程碑 M1–M99、承诺条款 CT01–CT99 等，正文与表格一律不得出现
# （里程碑/节点只写名称+日期）。招标侧 ID（M-VETO-xx / R0xx / 评分项 SX）不在此列——
# M\d/CT\d 的前后边界与"非字母数字"约束保证不会误伤 M-VETO-01、R031、CMMI3、ISO27001 等。
SELFCODE_RE = re.compile(r"(?<![0-9A-Za-z])(?:M\d{1,2}|CT\d{1,2})(?![0-9A-Za-z])")
# 三段式要素
EFFECT_RE = re.compile(r"(确保|实现|形成|做到|达到|推动|为[^。]{0,10}提供)")
LOCATE_RE = re.compile(r"(本阶段|本环节|本节|本章|本工作|核心目标|旨在|致力于)")
# 极致承诺：人员更换提前期
LEADTIME_RE = re.compile(r"提前\s*(\d+)\s*个工作日")
# 仅在人员更换/替换语境内的提前期才计入不一致（仿 check_commitment_terms）
STAFF_REPLACEMENT_RE = re.compile(r"人员(?:更换|替换|变更|调整)|(?:更换|替换|变更)人员")


def count_han(s):
    return len(re.findall(rf"[{HAN}]", s))


def run(sections_dir):
    files = sorted(Path(sections_dir).glob("*.md"))
    issues = []

    method_hits = []  # 引号自创方法名（出现次数）
    parallel_groups = 0
    textbook_hits = 0
    label_lines = []  # (file, 文本)
    fig_leaks = []  # (file, 文本)
    echo_hits = []  # (file, 文本) 正文回显 ID/照抄原文
    selfcode_hits = []  # (file, 文本) 我方自创辅助编号（M1/CT01 等）
    blacklist_hits = defaultdict(int)
    bad_addr_hits = defaultdict(int)
    leadtimes = set()
    para_total = 0
    para_good = 0
    section_figs = []  # [(文件名, 首个标题, figure 块数)]
    soft_spam = []  # [(文件名, 软词, 单节次数)]

    for f in files:
        in_figure = in_code = False
        cur_title = None
        fig_blocks = 0
        soft_counts = defaultdict(int)
        for raw in f.read_text(encoding="utf-8").splitlines():
            line = raw.rstrip()
            stripped = line.lstrip()

            # 维护围栏状态
            if stripped.startswith("```"):
                info = stripped[3:].strip().lower()
                if not in_code and not in_figure:
                    if info == "figure":
                        in_figure = True
                        fig_blocks += 1
                    else:
                        in_code = True
                else:
                    in_figure = in_code = False
                continue
            if in_figure or in_code:
                continue  # 围栏内内容不计入文风

            if not stripped:
                continue

            # 我方自创辅助编号（M1/CT01 等）——正文与表格都不许出现（招标侧 M-VETO-/R0 不会匹配）
            sc = SELFCODE_RE.findall(line)
            if sc:
                selfcode_hits.append((f.name, "、".join(sorted(set(sc)))[:40]))

            # figure 字段裸泄漏（在围栏外出现 id:/type: 等）
            if FIG_LEAK_RE.match(stripped):
                fig_leaks.append((f.name, stripped[:40]))
                continue

            # 标题行不计文风（顺手记首个标题供配图维度判型）
            if stripped.startswith("#"):
                if cur_title is None:
                    cur_title = stripped.lstrip("#").strip() or None
                continue
            # 表格行不计文风（偏离表/索引表里引用 ID 是正确的，故先豁免再查回显）
            if stripped.startswith("|"):
                continue

            # 正文回显需求/评分 ID 或照抄原文
            if ECHO_RE.search(stripped):
                echo_hits.append((f.name, stripped[:40]))

            # 标签矩阵
            if LABEL_RE.match(stripped):
                label_lines.append((f.name, stripped[:24]))

            # 全局计数（含 bullet 行也统计骈偶/方法名/黑名单/称谓）
            parallel_groups += len(PARALLEL_RE.findall(line))
            for q in QUOTED_RE.findall(line):
                if q.endswith(METHOD_SUFFIX):
                    method_hits.append(q)
            for t in TEXTBOOK:
                textbook_hits += len(re.findall(re.escape(t), line, re.I))
            for w in BLACKLIST:
                blacklist_hits[w] += line.count(w)
            for w in SOFT_BLACKLIST:
                soft_counts[w] += line.count(w)
            for a in BAD_ADDRESS:
                bad_addr_hits[a] += line.count(a)
            if STAFF_REPLACEMENT_RE.search(line):
                for n in LEADTIME_RE.findall(line):
                    leadtimes.add(int(n))

            # 段落质量：非 bullet、足够长的正文段
            if not BULLET_RE.match(stripped) and count_han(line) >= PARA_MIN_HAN:
                para_total += 1
                has_method = any(
                    q.endswith(METHOD_SUFFIX) for q in QUOTED_RE.findall(line)
                )
                has_parallel = bool(PARALLEL_RE.search(line))
                if EFFECT_RE.search(line) and (has_method or has_parallel):
                    para_good += 1

        section_figs.append((f.name, cur_title or f.stem, fig_blocks))
        for w, c in soft_counts.items():
            if c > SOFT_BLACKLIST_MAX:
                soft_spam.append((f.name, w, c))

    # bullet 占比：统计全部 bullet 行 vs 正文段
    bullet_lines = 0
    body_lines = 0
    for f in files:
        in_fig = in_code = False
        for raw in f.read_text(encoding="utf-8").splitlines():
            s = raw.strip()
            if s.startswith("```"):
                info = s[3:].strip().lower()
                if not in_code and not in_fig:
                    in_fig = info == "figure"
                    in_code = info != "figure"
                else:
                    in_fig = in_code = False
                continue
            if in_fig or in_code or not s or s.startswith("#") or s.startswith("|"):
                continue
            body_lines += 1
            if BULLET_RE.match(s):
                bullet_lines += 1

    # ---- 生成 issues ----
    bad_addr = {k: v for k, v in bad_addr_hits.items() if v}
    if bad_addr:
        detail = "、".join(f"{k}×{v}" for k, v in bad_addr.items())
        issues.append(
            {
                "desc": f"称谓违规（应为「贵司/我方」）：{detail}",
                "severity": "high",
                "veto": False,
                "hits": bad_addr,
            }
        )

    if len(label_lines) > MAX_LABEL_MATRIX:
        ex = "；".join(f"{fn}:{tx}" for fn, tx in label_lines[:3])
        issues.append(
            {
                "desc": f"出现响应标签矩阵 {len(label_lines)} 处，应改写为连贯标书段落（如 {ex}）",
                "severity": "high",
                "veto": False,
                "count": len(label_lines),
            }
        )

    if fig_leaks:
        ex = "；".join(f"{fn}:{tx}" for fn, tx in fig_leaks[:3])
        issues.append(
            {
                "desc": f"figure 规格块未用 ```figure 围栏，裸泄漏为正文 {len(fig_leaks)} 行（如 {ex}）",
                "severity": "high",
                "veto": False,
                "count": len(fig_leaks),
            }
        )

    if echo_hits:
        ex = "；".join(f"{fn}:{tx}" for fn, tx in echo_hits[:3])
        issues.append(
            {
                "desc": f"正文回显需求/评分 ID 或照抄原文 {len(echo_hits)} 处（应内化为标书正文，ID 仅入索引表/偏离表），如 {ex}",
                "severity": "high",
                "veto": False,
                "count": len(echo_hits),
            }
        )

    if selfcode_hits:
        ex = "；".join(f"{fn}:{tx}" for fn, tx in selfcode_hits[:3])
        issues.append(
            {
                "desc": f"正文/表格出现我方自创辅助编号（如里程碑 M1、承诺 CT01）{len(selfcode_hits)} 处"
                f"（里程碑/节点只写名称+日期；招标侧条款/需求 ID 仅入索引表/偏离表），如 {ex}",
                "severity": "high",
                "veto": False,
                "count": len(selfcode_hits),
            }
        )

    if len(method_hits) < MIN_METHOD_NAMES:
        issues.append(
            {
                "desc": f"引号自创方法名偏少：{len(method_hits)} 处（建议≥{MIN_METHOD_NAMES}）",
                "severity": "medium",
                "veto": False,
            }
        )
    if method_hits and textbook_hits > len(method_hits):
        issues.append(
            {
                "desc": f"方法论以教科书名为主（教科书名 {textbook_hits} 次 > 自创命名 {len(method_hits)} 次），"
                f"应改为自创气派命名",
                "severity": "medium",
                "veto": False,
            }
        )

    if para_total >= MIN_PARAS_FOR_PARALLEL and parallel_groups < round(
        PARALLEL_RATIO * para_total
    ):
        issues.append(
            {
                "desc": f"四字并列密度偏低：{parallel_groups} 组 / {para_total} 实义段"
                f"（建议≥{int(PARALLEL_RATIO * 100)}%）",
                "severity": "medium",
                "veto": False,
            }
        )

    if body_lines and bullet_lines > body_lines - bullet_lines:
        issues.append(
            {
                "desc": f"正文被 bullet 列表主导（bullet {bullet_lines} 行 / 正文段 {body_lines - bullet_lines} 行），"
                f"缺连贯标书段落",
                "severity": "medium",
                "veto": False,
            }
        )

    if para_total >= 5 and para_good / para_total < PARA_QUALITY_RATIO:
        issues.append(
            {
                "desc": f"多数正文段落缺三段式/骈偶要素：合格 {para_good}/{para_total}"
                f"（要素=效果收束句 + 方法名或四字并列）",
                "severity": "medium",
                "veto": False,
            }
        )

    bl = {k: v for k, v in blacklist_hits.items() if v}
    if bl:
        detail = "、".join(f"{k}×{v}" for k, v in bl.items())
        issues.append(
            {
                "desc": f"空词黑名单命中：{detail}",
                "severity": "medium",
                "veto": False,
                "hits": bl,
            }
        )

    if soft_spam:
        ex = "；".join(f"{fn}:{w}×{c}" for fn, w, c in soft_spam[:3])
        issues.append(
            {
                "desc": f"软空词单节刷屏（疑似 buzzword 堆砌，>{SOFT_BLACKLIST_MAX}/节）{len(soft_spam)} 处（如 {ex}）",
                "severity": "medium",
                "veto": False,
                "count": len(soft_spam),
            }
        )

    figure_missing = [
        (fn, t)
        for fn, t, nf in section_figs
        if nf == 0 and any(k in t for k in FIGURE_EXPECTED_KEYWORDS)
    ]
    if figure_missing:
        ex = "；".join(f"{fn}:{t}" for fn, t in figure_missing[:3])
        issues.append(
            {
                "desc": f"方案/架构类小节缺配图（未见 ```figure 规格块）{len(figure_missing)} 节（如 {ex}）",
                "severity": "medium",
                "veto": False,
                "count": len(figure_missing),
            }
        )

    if len(leadtimes) > 1:
        issues.append(
            {
                "desc": f"极致承诺数值不一致：人员更换提前期出现多个值 {sorted(leadtimes)} 个工作日",
                "severity": "medium",
                "veto": False,
            }
        )

    return {
        "check": "style",
        "ok": len(issues) == 0,
        "stats": {
            "method_names": len(method_hits),
            "textbook_names": textbook_hits,
            "parallel_groups": parallel_groups,
            "label_matrix_lines": len(label_lines),
            "figure_leaks": len(fig_leaks),
            "echo_hits": len(echo_hits),
            "figure_blocks": sum(nf for _, _, nf in section_figs),
            "figure_missing_sections": len(figure_missing),
            "soft_blacklist_spam": len(soft_spam),
            "bullet_lines": bullet_lines,
            "body_lines": body_lines,
            "para_quality": f"{para_good}/{para_total}",
            "blacklist_hits": sum(bl.values()) if bl else 0,
            "bad_address_hits": sum(bad_addr.values()) if bad_addr else 0,
        },
        "issues": issues,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", required=True)
    args = ap.parse_args()
    res = run(args.sections)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
