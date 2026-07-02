#!/usr/bin/env python3
"""按招标文件 required_outline / outline_skeleton.json 生成规划大纲。

规划输出遵守两层契约：
- `sections` 只放技术文件装订主干：前置两张响应索引表 + 技术文件一至八章。
- `volumes` 放独立分册覆盖映射：商务、资格、报价不进入技术文件编号序列，但仍参与覆盖检查。
"""
import argparse
import json
import re
from pathlib import Path

HAN_NO = {
    "一": "tech-performance-files",
    "二": "tech-team-situation",
    "三": "tech-understanding",
    "四": "tech-workplan",
    "五": "tech-fulfillment-quality",
    "六": "tech-service-commitment",
    "七": "tech-supporting-materials",
    "八": "tech-project-cases",
}

KNOWN_SECTION_IDS = {
    "业绩文件": "tech-performance-files",
    "项目团队情况": "tech-team-situation",
    "对项目的理解": "tech-understanding",
    "工作规划描述": "tech-workplan",
    "履约能力及质量保证措施": "tech-fulfillment-quality",
    "服务承诺": "tech-service-commitment",
    "项目案例": "tech-project-cases",
}


def section_id_for(title, order):
    """按标题定 id：已知标题用语义 id，支撑材料用模式识别，其余按位置兜底。"""
    t = strip_no(title or "")
    if t in KNOWN_SECTION_IDS:
        return KNOWN_SECTION_IDS[t]
    if "支撑材料" in t:
        return "tech-supporting-materials"
    return f"tech-section-{order}"


ROLE_PATTERNS = [
    ("understanding", ["对项目的理解", "理解"]),
    ("keypoint", ["重难点", "重点、难点", "重点和难点", "难点分析", "重点分析"]),
    ("theory", ["理论内涵", "工具方法", "方法论", "理论框架"]),
    ("workplan", ["工作规划", "工作方案", "实施方案", "服务方案"]),
    ("fulfillment", ["履约", "质量保证"]),
    ("commitment", ["服务承诺"]),
    ("supporting", ["支撑材料"]),
    ("performance", ["业绩"]),
    ("cases", ["项目案例", "案例"]),
    ("team", ["团队", "人员"]),
]


def detect_role(title):
    t = strip_no(title or "")
    for role, kws in ROLE_PATTERNS:
        if any(k in t for k in kws):
            return role
    return "generic"


CLAUSE_KEYWORD_ROLE = [
    (("业绩", "虚假"), "performance"),
    (("项目负责人", "工作人员", "人员"), "team"),
    (("保密", "知识产权"), "commitment"),
]

ROLE_BACKING = {
    "performance": [
        ("case_studies", "业绩文件", "待填(来源:同类项目合同/验收材料/业绩证明)")
    ],
    "team": [
        (
            "team_members",
            "项目团队成员与项目负责人经验",
            "待填(来源:项目团队简历/社保证明/同类项目经验证明)",
        )
    ],
    "fulfillment": [
        (
            "company_profile",
            "履约能力",
            "待填(来源:投标人公司简介/资质证书/同类业绩/平台说明)",
        ),
        (
            "platforms_and_tools",
            "平台工具与项目管理能力",
            "待填(来源:系统平台说明/数据库采购证明/工具截图)",
        ),
    ],
    "commitment": [
        (
            "service_commitments",
            "服务响应与售后承诺口径",
            "待填(来源:投标人服务承诺口径)",
        )
    ],
    "supporting": [
        (
            "equipment",
            "设备设施配置情况",
            "待填(来源:投标人拟投入设备清单/系统平台说明/数据库采购证明)",
        ),
        ("patents", "专利数量", "待填(来源:专利证书)"),
        ("performance_records", "绩效评价", "待填(来源:供应商绩效评价结果)"),
    ],
    "cases": [
        ("case_studies", "同类项目案例", "待填(来源:同类项目合同/验收材料/成果节选)")
    ],
}

FRONT_IDS = {
    "评分要素响应索引表": "front-scoring-response-index",
    "技术规范书响应索引表": "front-techspec-response-index",
}

DEFAULT_REQUIRED_COMMITMENTS = [
    "服务合规承诺",
    "保密与合规承诺",
    "人员稳定与替换机制",
    "售后与持续服务承诺",
]


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def load_optional_json(path):
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"找不到可选输入文件：{p}")
    return load_json(p)


def profile_patterns(profile):
    return ((profile or {}).get("bidder_outline_profile") or {}).get("patterns", {})


def clone_children(children):
    return json.loads(json.dumps(children or [], ensure_ascii=False))


def _resolve_flag(node, key, parent_value):
    """节点 flag 为 None/缺失时继承父值；已是 bool 则保留。"""
    value = node.get(key)
    return value if isinstance(value, bool) else parent_value


def normalize_outline_flags(sections, parent_fsd=False, parent_cr=False):
    """递归填空 required_outline 节点的 format_self_defined / creative_required：
    None 或缺失 → 继承最近祖先 bool（顶层祖先为 False）；已有 bool 保留。
    纯函数：返回新结构，不改入参。"""
    result = []
    for node in sections or []:
        new_node = dict(node)
        fsd = _resolve_flag(node, "format_self_defined", parent_fsd)
        cr = _resolve_flag(node, "creative_required", parent_cr)
        new_node["format_self_defined"] = fsd
        new_node["creative_required"] = cr
        new_node["children"] = normalize_outline_flags(node.get("children"), fsd, cr)
        result.append(new_node)
    return result


def derived_expansion_by_title(tender):
    result = {}
    derived = (tender or {}).get("derived_outline") or {}
    for item in derived.get("section_expansions", []) or []:
        title = item.get("target_section")
        if title:
            result[title] = item
    return result


# 招标单位隶属链都缺失时的通用多层递进兜底（不写死任何组织名，只给"层级类型"占位，
# 供枪手按 writer_brief 自上而下填实；避免背景退化成只有"国家层面"一层）。
GENERIC_BACKGROUND_LAYERS = [
    "国家层面",
    "行业与监管层面",
    "招标单位本级",
]


def make_background_children(tender, profile):
    """背景层级**兜底**推导：仅在 required_outline/derived_outline 都未给背景子节时才用
    （正常路径下真实层级已由拆标 required_outline 按本项目实际隶属链抽取，更准、含中间层）。
    锚点：国家政策层（常设）→ purchaser（行业/省）→ supervising_dept（集团/上级，有才加）→
    project_unit（本单位）；缺失的层跳过，层数随单位级别变化。不写死组织名、不套固定五层。
    若隶属链字段**全部缺失**，退回通用多层递进脚手架（GENERIC_BACKGROUND_LAYERS），
    保证目录不会退化成只有"国家层面"一层。"""
    project = (tender or {}).get("project", {}) or {}
    titles = ["国家层面"]
    for field in ("purchaser", "supervising_dept", "project_unit"):
        name = project.get(field)
        if name:
            titles.append(f"{name}层面")
    # 隶属链一个都没抽到 → 用通用多层脚手架，而非单层"国家层面"
    if len(titles) == 1:
        titles = list(GENERIC_BACKGROUND_LAYERS)
    seen, uniq = set(), []
    for t in titles:
        if t not in seen:
            seen.add(t)
            uniq.append(t)
    return [{"no": str(idx), "title": title} for idx, title in enumerate(uniq, 1)]


def profile_children_for(title, tender, profile):
    patterns = profile_patterns(profile)
    role = detect_role(title)
    if role == "understanding":
        return [
            {
                "no": "（一）",
                "title": "项目背景",
                "children": make_background_children(tender, profile),
                "source_gap": "待填(来源:项目单位介绍/官网/内部资料)",
            },
            {
                "no": "（二）",
                "title": "项目重难点分析及应对措施",
                "children": clone_children(
                    patterns.get("diagnosis_pattern", {}).get(
                        "default_children",
                        [
                            {"no": "1", "title": "项目重点分析及应对措施"},
                            {"no": "2", "title": "项目难点分析及应对措施"},
                        ],
                    )
                ),
            },
        ]
    if role == "commitment":
        commitments = (
            patterns.get("commitment_pattern", {}).get("required_commitments")
            or DEFAULT_REQUIRED_COMMITMENTS
        )
        return [
            {"no": f"（{idx}）", "title": name}
            for idx, name in enumerate(commitments, 1)
        ]
    role_pattern = {
        "workplan": "workplan_pattern",
        "fulfillment": "assurance_pattern",
        "supporting": "scoring_anchor_pattern",
        "cases": "case_pattern",
        "theory": "theory_method_pattern",
        "keypoint": "keypoint_difficulty_pattern",
    }
    pattern_name = role_pattern.get(role)
    if not pattern_name:
        return []
    return clone_children(patterns.get(pattern_name, {}).get("default_children", []))


def merge_children_for_node(node, tender, profile, derived_by_title):
    existing = node.get("children", []) or []
    title = node.get("title", "")
    if existing:
        return clone_children(existing), "required_outline"
    if not node.get("creative_required"):
        return [], "locked_empty"
    derived = derived_by_title.get(title)
    if derived and derived.get("children"):
        return clone_children(derived.get("children")), "derived_outline"
    profiled = profile_children_for(title, tender, profile)
    if profiled:
        return profiled, "bidder_outline_profile"
    return [], "empty"


def verified_items_for_category(knowledge_base, category):
    kb = (knowledge_base or {}).get("bidder_knowledge_base") or {}
    return [
        item
        for item in kb.get(category, []) or []
        if item.get("verification_status") == "verified"
    ]


def make_knowledge_briefs(role, knowledge_base):
    briefs = []
    for category, topic, fallback in ROLE_BACKING.get(role, []):
        verified = verified_items_for_category(knowledge_base, category)
        briefs.append(
            {
                "knowledge_category": category,
                "topic": topic,
                "verified_item_ids": [item["id"] for item in verified],
                "requires_verified_evidence": category
                in {"case_studies", "patents", "performance_records", "team_members"},
                "fallback_text": fallback,
            }
        )
    return briefs


def normalize_no(no):
    return str(no or "").strip().replace("、", "")


def strip_no(title):
    return re.sub(r"^[一二三四五六七八九十]+、\s*", "", title or "").strip()


_CHAPTER_NO_RE = re.compile(r"[一二三四五六七八九十]+")


def is_chapter_no(no):
    """编号是否为 CJK 序数章级编号（一/二/三…），用于识别『容器节点』。"""
    return bool(_CHAPTER_NO_RE.fullmatch(normalize_no(no)))


def flatten_chapters(sections):
    """防御式递归展平：某节点的全部子节点都带章级编号即视为容器，提升其子项为顶层章节；
    否则原样保留。处理拆标可能给出的『专项投标文件容器+一~十子项』嵌套形态，
    平铺形态（顶层一~八、子项为（一）/数字）不受影响。"""
    result = []
    for node in sections or []:
        children = node.get("children") or []
        if children and all(is_chapter_no(c.get("no")) for c in children):
            result.extend(flatten_chapters(children))
        else:
            result.append(node)
    return result


_MATCH_STRIP_RE = re.compile(r"[\"'“”‘’「」『』\s]")


def _match_key(title):
    """章节匹配键：去编号前缀和引号/空白，避免同一标题因字形差异丢覆盖。"""
    return _MATCH_STRIP_RE.sub("", strip_no(title or ""))


def collect_tree_titles(node, level=2):
    lines = []
    for child in node.get("children", []) or []:
        marker = "#" * level
        no = child.get("no")
        title = child.get("title", "")
        lines.append(f"{marker} {format_numbered_title(no, title)}".rstrip())
        lines.extend(collect_tree_titles(child, min(level + 1, 6)))
    return lines


def format_numbered_title(no, title):
    no = str(no or "").strip()
    title = str(title or "").strip()
    if not no:
        return title
    if no.isdigit():
        return f"{no}. {title}"
    if no.startswith("（") and no.endswith("）"):
        return f"{no}{title}"
    if no in HAN_NO:
        return f"{no}、{title}"
    return f"{no} {title}".strip()


def choose_required_outline(tender, skeleton, allow_skeleton_fallback=False):
    required = tender.get("required_outline")
    if required and required.get("sections"):
        return required, "tender.required_outline", False
    if not allow_skeleton_fallback:
        project = (
            tender.get("project", {}).get("name")
            or tender.get("project", {}).get("id")
            or "未知项目"
        )
        raise ValueError(
            f"缺少 required_outline，无法确定《{project}》的法定技术文件目录；"
            "请先重新拆标抽取 required_outline，或在人工确认本项目适用 outline_skeleton.json 后显式启用骨架兜底。"
        )
    fallback = dict(skeleton)
    fallback["fallback_used"] = True
    fallback["fallback_reason"] = (
        "tender.json 未提供 required_outline，使用技能内置 references/outline_skeleton.json"
    )
    return fallback, "outline_skeleton.json", True


def add_cover(section_by_id, section_id, cover):
    if not cover or section_id not in section_by_id:
        return
    covers = section_by_id[section_id].setdefault("covers", [])
    if cover not in covers:
        covers.append(cover)


def scoring_label(scoring):
    weight = scoring.get("weight")
    suffix = f"，{weight}分" if weight is not None else ""
    return f"{scoring.get('id')} {scoring.get('item', '')}{suffix}".strip()


def stable_unique(items):
    result = []
    seen = set()
    for item in items:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def requirement_ids(tender, categories=None, keywords=()):
    cats = set(categories or [])
    ids = []
    for req in tender.get("requirements", []) or []:
        if cats and req.get("category") not in cats:
            continue
        text = req.get("text") or ""
        if keywords and not any(k in text for k in keywords):
            continue
        ids.append(req.get("id"))
    return stable_unique(ids)


def qualification_ids_matching(tender, keywords):
    ids = []
    for qual in tender.get("qualifications", []) or []:
        text = " ".join(str(qual.get(k, "")) for k in ("type", "desc", "evidence"))
        if any(k in text for k in keywords):
            ids.append(qual.get("id"))
    return stable_unique(ids)


def build_front_sections(required, tender):
    front = []
    for idx, item in enumerate(required.get("front_matter", []) or [], 1):
        title = item.get("title", f"响应索引表{idx}")
        front.append(
            {
                "id": FRONT_IDS.get(title, f"front-index-{idx}"),
                "file": "技术投标文件",
                "order": idx,
                "title": title,
                "outline_title": title,
                "outline_type": "front_matter",
                "type": item.get("type", "index"),
                "maps_to": item.get("maps_to", ""),
                "covers": [],
                "index_rows": [],
            }
        )
    return front


def build_technical_sections(
    required, start_order, tender=None, profile=None, knowledge_base=None
):
    sections = []
    derived_by_title = derived_expansion_by_title(tender or {})
    normalized = normalize_outline_flags(required.get("sections", []) or [])
    for offset, node in enumerate(flatten_chapters(normalized), start_order):
        no = normalize_no(node.get("no"))
        sid = section_id_for(node.get("title"), offset)
        title = (
            f"{no}、{node.get('title')}"
            if no
            else node.get("title", f"技术章节{offset}")
        )
        children, children_source = merge_children_for_node(
            node, tender or {}, profile, derived_by_title
        )
        sections.append(
            {
                "id": sid,
                "file": "技术投标文件",
                "order": offset,
                "no": no,
                "title": title,
                "outline_title": node.get("title", strip_no(title)),
                "outline_type": "section",
                "format_self_defined": node.get("format_self_defined", False),
                "creative_required": node.get("creative_required", False),
                "source": node.get("source", required.get("source")),
                "children": children,
                "outline_sources": {
                    "section": "required_outline",
                    "children": children_source,
                },
                "knowledge_briefs": make_knowledge_briefs(
                    detect_role(node.get("title")), knowledge_base
                ),
                "covers": [],
                "must_keep": [],
                "writer_brief": make_writer_brief(node),
            }
        )
    return sections


def make_writer_brief(node):
    role = detect_role(node.get("title", ""))
    briefs = {
        "understanding": "项目背景按招标单位实际隶属层级自上而下递进（层级以招标文件法定目录/单位隶属链为准，依单位级别可多可少、不套固定模板），每层落 2–3 个具体论点（政策/要求/现状）；项目重难点逐条列举，每条=问题界定→影响→针对性应对措施。",
        "keypoint": "项目重点、难点逐条列举，每条=问题界定→对项目的影响→针对性应对措施，重点与难点分列。",
        "workplan": "依次写服务目标、服务范围与要求、项目总体思路（分项服务按 准备→实施→评价 阶段组织，每阶段列做法与产出）、项目整体计划（里程碑/进度）、服务成果交付与验收（交付物清单+验收标准）。",
        "fulfillment": "履约能力、工作进度保证、质量保证、知识产权管理、保密机制逐项写，每项=措施陈述+可执行机制（组织/流程/工具/责任/指标），证据落附件。",
        "commitment": "每条服务承诺落到可执行机制：触发条件→响应动作→责任人→时限→违约责任；同一承诺数值全文一致。",
        "supporting": "逐项对应技术评分标准子项，每项=得分点→我方做法/证据→附件锚点，形成评委可定位的得分锚点。",
        "theory": "涉及理论/方法论的小节按 理论内涵 + 工具方法 双拼：先界定理论框架，再给可操作工具与步骤。",
        "performance": "以业绩一览表组织（来自知识库 verified 业绩）：逐项列项目名/规模/角色/周期/验收，附证据引用；素材缺失写待填，不编造。",
        "team": "以组织结构+核心成员表组织（来自知识库）：项目负责人重点经验、成员分工与投入、社保/资质证据引用；缺失写待填，不编造。",
        "cases": "每个案例节选写 项目背景/我方角色/关键做法/量化成果/客户，附证据引用；素材缺失写待填，不编造。",
    }
    return briefs.get(role, "按招标文件法定技术文件目录起草，保持编号、层级和顺序。")


def assign_technical_covers(tender, sections):
    by_title = {_match_key(s.get("outline_title", "")): s for s in sections}
    role_to_section = {detect_role(s.get("outline_title", "")): s for s in sections}

    def add(sec, cover):
        if sec is not None and cover:
            covers = sec.setdefault("covers", [])
            if cover not in covers:
                covers.append(cover)

    for scoring in tender.get("scoring", []) or []:
        if scoring.get("category") == "价格":
            continue
        sec = by_title.get(_match_key(scoring.get("target_section", "") or ""))
        add(sec, scoring.get("id"))
        if sec is not None and scoring.get("must_keep"):
            sec.setdefault("must_keep", []).extend(scoring["must_keep"])

    derived = tender.get("derived_outline") or {}
    refs = list(derived.get("section_expansions") or []) + list(
        derived.get("requirement_groups") or []
    )
    for ref in refs:
        sec = by_title.get(_match_key(ref.get("target_section", "") or ""))
        for rid in ref.get("requirement_ids") or []:
            add(sec, rid)
        for item in ref.get("items") or []:
            # schema 规定 items 是原文要求字符串数组（无 id/preferred_section）；
            # 仅当拆标给出 dict 形态时才作为 cover 来源，避免 str.get 崩溃。
            if not isinstance(item, dict):
                continue
            target = (
                by_title.get(_match_key(item.get("preferred_section", "") or "")) or sec
            )
            add(target, item.get("id"))

    for clause in tender.get("mandatory_clauses", []) or []:
        desc = clause.get("desc", "")
        for keys, role in CLAUSE_KEYWORD_ROLE:
            if any(k in desc for k in keys):
                add(role_to_section.get(role), clause.get("id"))


def assign_whole_volume_covers(tender, front_sections):
    """整册级评分项由前置评分要素响应索引表整体承载，不强迫绑定单一技术章节。"""
    index = next(
        (s for s in front_sections if s.get("id") == "front-scoring-response-index"),
        None,
    )
    if index is None:
        return
    for scoring in tender.get("scoring", []) or []:
        if scoring.get("category") == "价格":
            continue
        if scoring.get("target_scope") == "whole_technical_volume" and scoring.get(
            "id"
        ):
            covers = index.setdefault("covers", [])
            if scoring["id"] not in covers:
                covers.append(scoring["id"])


def build_independent_volumes(tender, technical_sections):
    business_ids = [
        s["id"] for s in tender.get("scoring", []) or [] if s.get("category") == "商务"
    ]
    mandatory_ids = [
        m["id"] for m in tender.get("mandatory_clauses", []) or [] if m.get("veto")
    ]
    mandatory_order = {
        clause["id"]: idx
        for idx, clause in enumerate(tender.get("mandatory_clauses", []) or [])
        if clause.get("id")
    }
    price_mandatory = [
        mid
        for mid in mandatory_ids
        if any(word in mid for word in [])  # 保留扩展点，价格红线下方按描述分配
    ]
    for clause in tender.get("mandatory_clauses", []) or []:
        desc = clause.get("desc", "")
        if any(key in desc for key in ("报价", "价格", "限价", "税率", "低于成本")):
            price_mandatory.append(clause["id"])
    price_mandatory = sorted(
        set(price_mandatory),
        key=lambda mid: mandatory_order.get(mid, len(mandatory_order)),
    )
    compliance_mandatory = [mid for mid in mandatory_ids if mid not in price_mandatory]
    qualification_covers = requirement_ids(tender, ("资格",))
    financial_covers = requirement_ids(
        tender, ("商务",), ("财务", "保证金", "审计报告")
    )
    financial_covers += qualification_ids_matching(tender, ("财务", "审计报告"))
    deviation_covers = requirement_ids(tender, ("商务",), ("偏离",))
    compliance_requirements = requirement_ids(tender, ("递交", "格式", "合同"))
    price_requirements = requirement_ids(tender, ("报价",))

    business_sections = [
        {
            "id": "biz-strength",
            "file": "商务投标文件",
            "order": 1,
            "title": "投标人综合实力与商务响应说明",
            "outline_type": "independent_volume",
            "covers": business_ids,
        },
        {
            "id": "biz-qualification",
            "file": "商务投标文件",
            "order": 2,
            "title": "资格证明与信用合规承诺",
            "outline_type": "independent_volume",
            "covers": stable_unique(
                qualification_covers
                + [
                    mid
                    for mid in compliance_mandatory
                    if "VETO-0" in mid or "VETO-1" in mid
                ]
            ),
        },
        {
            "id": "biz-financial-deposit",
            "file": "商务投标文件",
            "order": 3,
            "title": "财务状况与投标保证金",
            "outline_type": "independent_volume",
            "covers": stable_unique(financial_covers),
        },
        {
            "id": "biz-deviation",
            "file": "商务投标文件",
            "order": 4,
            "title": "商务条款响应/偏离表",
            "outline_type": "independent_volume",
            "covers": stable_unique(deviation_covers),
        },
        {
            "id": "compliance",
            "file": "商务投标文件",
            "order": 5,
            "title": "投标函与投标合规承诺",
            "outline_type": "independent_volume",
            "covers": stable_unique(compliance_mandatory + compliance_requirements),
        },
    ]
    price_sections = [
        {
            "id": "price-proposal",
            "file": "报价文件",
            "order": 1,
            "title": "报价说明与承诺",
            "outline_type": "independent_volume",
            "covers": stable_unique(["价格"] + price_mandatory + price_requirements),
        }
    ]
    return [
        {"name": "技术投标文件", "sections": technical_sections},
        {"name": "商务投标文件", "sections": business_sections},
        {"name": "报价文件", "sections": price_sections},
    ]


def add_index_rows(outline, tender):
    section_by_cover = {}
    for section in iter_cover_sections(outline):
        for cover in section.get("covers", []) or []:
            section_by_cover.setdefault(cover, section)
    for section in outline["sections"]:
        if section["id"] == "front-scoring-response-index":
            rows = []
            for scoring in tender.get("scoring", []) or []:
                if scoring.get("category") == "价格":
                    continue
                target = section_by_cover.get(scoring.get("id"))
                rows.append(
                    {
                        "requirement": scoring_label(scoring),
                        "location": target["title"] if target else "待映射",
                        "page": "装订后回填",
                    }
                )
            section["index_rows"] = rows
        elif section["id"] == "front-techspec-response-index":
            rows = []
            for req in tender.get("requirements", []) or []:
                if req.get("category") != "技术":
                    continue
                target = section_by_cover.get(req.get("id"))
                rows.append(
                    {
                        "requirement": f"{req.get('id')} {req.get('text', '')[:48]}",
                        "location": target["title"] if target else "待映射",
                        "page": "装订后回填",
                    }
                )
            section["index_rows"] = rows


def iter_cover_sections(outline):
    seen = set()
    for section in outline.get("sections", []) or []:
        sid = section.get("id")
        if sid not in seen:
            seen.add(sid)
            yield section
    for volume in outline.get("volumes", []) or []:
        for section in volume.get("sections", []) or []:
            sid = section.get("id")
            if sid not in seen:
                seen.add(sid)
                yield section


def build_outline(
    tender, skeleton, profile=None, knowledge_base=None, allow_skeleton_fallback=False
):
    required, source, skeleton_fallback_used = choose_required_outline(
        tender, skeleton, allow_skeleton_fallback=allow_skeleton_fallback
    )
    front = build_front_sections(required, tender)
    technical = build_technical_sections(
        required,
        len(front) + 1,
        tender=tender,
        profile=profile,
        knowledge_base=knowledge_base,
    )
    assign_technical_covers(tender, technical)
    assign_whole_volume_covers(tender, front)
    outline = {
        "_meta": {
            "generated_by": "bid-section-writer/scripts/build_outline.py",
            "source": source,
            "skeleton_fallback_used": skeleton_fallback_used,
            "required_outline_fallback_used": bool(
                (tender.get("required_outline") or {}).get("fallback_used")
            ),
            "project": tender.get("project", {}).get("name"),
            "tender_no": tender.get("project", {}).get("id"),
            "coverage_check": "技术文件主干来自 required_outline；商务/资格/报价在 volumes 中独立覆盖",
            "four_input_model": {
                "required_outline": bool(required),
                "derived_outline": bool(tender.get("derived_outline")),
                "bidder_outline_profile": bool(profile),
                "bidder_knowledge_base": bool(knowledge_base),
            },
        },
        "numbering": required.get("numbering", skeleton.get("numbering", {})),
        "front_matter": required.get("front_matter", []),
        "sections": front + technical,
        "volumes": [],
        "assembly_notes": {
            "technical_main": [s["id"] for s in front + technical],
            "independent_volumes": ["商务投标文件", "报价文件"],
            "deviation_table_rule": "偏离表作为章末小节或附录，不进入技术文件主目录。",
        },
    }
    outline["volumes"] = build_independent_volumes(tender, technical)
    add_index_rows(outline, tender)
    return outline


def write_placeholder_sections(outline, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for section in outline.get("sections", []) or []:
        lines = [f"# {section['title']}", ""]
        if section.get("outline_type") == "front_matter":
            lines.extend(index_markdown(section))
        else:
            lines.extend(technical_section_markdown(section))
        (out / f"{section['id']}.md").write_text(
            "\n".join(lines).rstrip() + "\n", encoding="utf-8"
        )


def index_markdown(section):
    rows = section.get("index_rows", []) or []
    lines = [
        "| 要求 | 响应位置 | 页码 |",
        "|---|---|---|",
    ]
    if rows:
        for row in rows:
            lines.append(
                f"| {row['requirement']} | {row['location']} | {row['page']} |"
            )
    else:
        lines.append("| 待填(来源:招标文件) | 待映射 | 装订后回填 |")
    return lines


def technical_section_markdown(section):
    lines = []
    children = collect_tree_titles(section, level=2)
    if children:
        lines.extend(children)
        lines.append("")
    briefs = section.get("knowledge_briefs", []) or []
    if briefs:
        lines.extend(
            [
                "## 知识库检索要求",
                "",
                "| 知识库分类 | 用途 | 已核验素材 | 缺失处理 |",
                "|---|---|---|---|",
            ]
        )
        for brief in briefs:
            verified = "、".join(brief.get("verified_item_ids", [])) or "无"
            lines.append(
                f"| {brief['knowledge_category']} | {brief['topic']} | {verified} | {brief['fallback_text']} |"
            )
        lines.append("")
    lines.extend(
        [
            f"本章依据招标文件法定技术文件目录设置，响应范围包括：{', '.join(section.get('covers', []) or ['待映射'])}。",
            "正式起草时应保持本章编号、标题和层级不变，并按照评分要素、技术规范书条款和证明材料逐项展开。",
            "待填(来源:招标文件、技术规范书、项目资料)。",
        ]
    )
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tender", required=True)
    ap.add_argument(
        "--skeleton",
        default=str(
            Path(__file__).resolve().parent.parent
            / "references"
            / "outline_skeleton.json"
        ),
        help="兜底骨架，默认取技能内置 references/outline_skeleton.json（随技能 zip 部署，Wegent 上无需仓库根文件）",
    )
    ap.add_argument("--profile", default=None, help="可选：投标人大纲扩写画像 JSON")
    ap.add_argument("--knowledge-base", default=None, help="可选：投标人知识库 JSON")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sections-out", default=None, help="可选：生成技术文件占位章节")
    ap.add_argument(
        "--allow-skeleton-fallback",
        action="store_true",
        help="仅在人工确认当前项目适用 outline_skeleton.json 时启用；默认缺 required_outline 即阻断",
    )
    args = ap.parse_args()

    tender = load_json(args.tender)
    skeleton = load_json(args.skeleton)
    profile = load_optional_json(args.profile)
    knowledge_base = load_optional_json(args.knowledge_base)
    outline = build_outline(
        tender,
        skeleton,
        profile=profile,
        knowledge_base=knowledge_base,
        allow_skeleton_fallback=args.allow_skeleton_fallback,
    )
    write_json(args.out, outline)
    if args.sections_out:
        write_placeholder_sections(outline, args.sections_out)
    print(
        f"已生成 {args.out}：技术文件主干 {len(outline['sections'])} 个节点，独立分册 {len(outline['volumes'])} 个"
    )


if __name__ == "__main__":
    main()
