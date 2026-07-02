---
name: tender-parser
description: 解析招投标招标文件，按"三遍阅读+要求矩阵"方法抽取项目信息、资格、评分项、废标(★)条款、编写要求与一张要求矩阵，输出结构化 tender.json。当需要"解析招标文件""抽取评分点""结构化招标要求""建立要求矩阵"时使用。
---

# tender-parser

把招标文件解析成下面的 JSON，写到 `workspace/tender.json`。方法遵循《提取经验》：
**先红线后得分；先前附表后全文；先格式后内容；先原文后改写；每条要求都要有响应、证据和位置。**

## 要求散落在哪（要求地图，逐处扫）
公告/投标邀请、投标人须知前附表、资格审查表、符合性审查表、评标办法/评分细则、
采购需求/技术规范、商务条款、合同条款及格式、投标文件格式、附件/清单、**投标文件构成**、
**技术文件目录**、**专项投标文件**、**应提交文件清单**、**澄清/修改/补遗（以最新版为准）**。

## 关键词扫描（抓硬要求）
强制：必须/须/应/应当/不得/不接受/禁止；材料：提供/附/原件/复印件/证明材料/承诺函；
签章格式：签字/盖章/公章/骑缝章/正本/副本/页码/密封/加密/上传；
风险：无效投标/废标/否决/拒收/实质性/最高限价/低于成本；符号：★ * ▲ ※。

## Schema
```json
{
  "project": {"id","name","budget","ceiling","currency","bid_deadline","joint_bid_allowed",
              "purchaser":"采购人/招标单位本级名称（如『国网甘肃省电力公司』『同兴智能公司』），无则 null",
              "supervising_dept":"上级/集团/监管单位名称（如『国家电网公司』，有才填，否则 null）",
              "project_unit":"项目落地的具体用户单位（常与 purchaser 同，若招标文件区分则单列，否则 null）",
              "amendments": ["澄清/补遗摘要，注明替代了哪条原条款"]},
  "target_package": {"分标","分包","子包",
    "weights": {"tech":0,"commerce":0,"price":0},
    "price_formula":"基准价公式原文","price_param_n":0.0,"tech_rubric_code":"JS-XXX"},
  "qualifications": [{"id":"Q1","desc","evidence"}],
  "scoring": [{"id":"S1","category":"技术|商务|价格","item","weight","must_keep":["关键词"],
              "target_section":"该评分项对应的法定技术文件章节标题（取自 required_outline.sections[].title）",
              "target_scope":"可选；评整册时填 whole_technical_volume，无单一对应章节"}],
  "mandatory_clauses": [{"id":"M1","marker":"★|▲","desc","veto": true}],
  "submission_rules": {"page_numbered","seal_required","blind_bid","blind_bid_note",
                       "required_materials": ["..."]},
  "writing_rules": {"volumes": ["资格/商务/技术/报价是否分册"],
                    "copies": "正本/副本/电子版份数",
                    "seal": "盖章/签字/骑缝章要求",
                    "seal_upload": "密封/加密/上传/解密规则",
                    "format": "目录/连续页码/是否胶装/命名要求"},
  "required_outline": {
    "source": "章节/条款/页；抽不到时写 fallback:outline_skeleton.json",
    "volume": "技术文件",
    "numbering": {"l1": "一、二、三…", "l2": "（一）（二）…", "l3": "1. 2. 3…"},
    "front_matter": [
      {"title": "评分要素响应索引表", "type": "index", "maps_to": "评分要素→正文页码"},
      {"title": "技术规范书响应索引表", "type": "index", "maps_to": "技术规范书条款→正文页码"}
    ],
    "sections": [
      {"no": "一", "title": "业绩文件", "source": "原文位置",
       "volume": "技术文件", "format_self_defined": false, "creative_required": false,
       "children": []},
      {"no": "三", "title": "对项目的理解", "source": "原文位置",
       "volume": "技术文件", "format_self_defined": true, "creative_required": true,
       "children": [
         {"no": "（一）", "title": "项目背景", "source": "原文位置",
          "format_self_defined": true, "creative_required": true, "children": []}
       ]}
    ],
    "fallback_used": false,
    "fallback_reason": null
  },
  "derived_outline": {
    "source": "技术规范书/采购需求/评分办法原文位置",
    "requirement_groups": [
      {"id": "DG001", "topic": "服务内容", "source": "原文位置", "items": ["原文要求"], "target_section": "对项目的理解"}
    ],
    "section_expansions": [
      {
        "target_section": "工作规划描述",
        "source": "原文位置",
        "expansion_type": "服务内容|交付成果|质量验收|保密|知识产权|人员稳定|评分响应",
        "requirement_ids": ["R001"],
        "requirements": ["原文要求"],
        "children": [
          {"no": "（一）", "title": "服务目标", "children": []},
          {"no": "（二）", "title": "服务范围与要求", "children": []}
        ]
      }
    ],
    "unmapped_requirements": [
      {"id": "DU001", "source": "原文位置", "text": "找不到 required_outline.sections[].title 对应章节的要求"}
    ]
  },
  "bidder_outline_profile": "用于 creative_required:true 章节的二/三级组织模式建议，默认读取 $SKILLS_DIR/bid-section-writer/references/bidder_outline_profile_ke-gai.json",
  "bidder_knowledge_base": "投标人背书型内容来源，默认读取 corpus/bidder_knowledge_base.json",
  "requirements": [
    {"id":"R001","source":"章节/条款/页","text":"原文要求(尽量原句)",
     "category":"资格|技术|商务|报价|格式|签章|密封|递交|评分|合同|废标",
     "priority":"A|B|C|D","substantive": true,
     "response":"承诺|逐条响应|证明材料|报价表|方案说明|偏离表",
     "evidence":"需提供的证明材料","owner":"商务|技术|法务|财务","risk":"缺材料/需澄清/口径限制"},
  ],
  "commitment_terms": {
    "_comment": "必须是 dict（不得直接产出条款 list）；无规定具体数值写 待填(来源:…) 或 以技术规范书/合同约定为准，不编造",
    "staff_replacement_notice_days": "人员更换提前期：数值 或 待填/以…为准",
    "response_mechanism": "响应口径", "response_hours": "响应时限：数值 或 待填",
    "after_service_months": "售后期限：数值 或 待填",
    "signatory": "{{bidder}}", "commitment_date": "投标日期/授权签署日，无则待填",
    "clauses": ["可选：服务承诺条款原文逐条"]
  }
}
```

## 规则
- `scoring/mandatory_clauses/submission_rules/qualifications` 是给确定性审稿脚本用的，**必须抽全**。
- **上游预切分**：拆标前操盘手先跑 `scripts/segment_tender.py --inputs inputs/final --out workspace`，把招标正文确定性切成
  `workspace/tender_segments/`（片段）、`workspace/tender_regions/`（结构化整区）、`workspace/tender_manifest.json`（分段清单+route_tags）、
  `workspace/veto_candidates.json`（红线候选）；拆标神探按这些产物分区阅读，不再直接读整份 `inputs/final` 长文本。
- **分块产出 + 校验式合并**：拆标按区块产 `workspace/tender_parts/*.json`（拓扑序：mandatory_clauses 先于 requirements；
  required_outline 先于 derived_outline），再用 `scripts/merge_tender.py` 合并成 `workspace/tender.json`。
  合并做确定性保证：必备键存在（project/qualifications/scoring/mandatory_clauses/submission_rules/required_outline/
  requirements/commitment_terms/target_package 缺一即报）+ 跨块引用闭合（derived_outline 的 target_section/requirement_ids 不得悬空）。
  缺块/悬空 → 非零退出，回拆标只重写对应 part 再合并。
- `target_package` 是分包锁定（P0）：从「评标办法前附表之六·分值构成（权重、价格公式、参数选择）」抽要投分包的
  权重(技:商:价)、价格公式、参数 n、技术评分细则代号 `tech_rubric_code`（形如 JS-XXX）。
  要投哪个分包由 `corpus/bid_config.json` 声明；单包文档自动锁定，多包缺声明则阻断回报操盘手。
- **按 rubric 锁 scoring**：前附表之四常含多套 JS- 技术详评模板，`scoring` 只抽
  `target_package.tech_rubric_code` 对应那一套，其余模板一律丢弃，否则评分项串味。
- `scoring[].target_section` 与 `derived_outline.*.target_section` 必须**逐字完整等于**
  `required_outline.sections[].title` 之一（含标点/引号），供规划阶段按标题分配 covers，并是 `merge_tender` 闭合硬闸门；
  抽不到对应章节时留空并在 notes 说明，不臆造。
- 评整个技术文件的总体评价类评分项（无单一对应章节）填 `target_scope: whole_technical_volume`，
  由前置评分要素响应索引表整体承载；其余评分项照常给 `target_section`。
- `required_outline` 是给规划阶段用的法定投标文件章节骨架，**不得压平成 requirements**。
  优先从"投标文件构成/技术文件目录/专项投标文件/应提交文件清单"抽取；识别标题后的
  "（格式自拟）"并标记 `format_self_defined:true`、`creative_required:true`。
  业绩文件、人员表、凭证、报价表、偏离表等填表/材料项通常 `creative_required:false`；
  对项目的理解、工作规划描述、履约能力及质量保证措施、服务承诺等正文方案项通常为 `true`。
  商务/资格/报价分册只在 `volume` 或 `writing_rules.volumes` 标明，不进入技术文件"一、二、三…"编号序列。
  抽不到法定目录时，回退读取技能内置 `references/outline_skeleton.json`，并设置
  `fallback_used:true`、`fallback_reason` 说明原因；仍抽不到则填 `null` 并写入 `notes`。
- **每节点带 bool flag**：`required_outline` 的每个 section/child 节点都必须带 bool 的 `format_self_defined` 与 `creative_required`，不许留空/ null；拿不准按父节点同类处理。
- **fallback_used 语义**：仅在**整份**法定目录抽不到、整份套用 `outline_skeleton.json` 时为 true；单独按惯例补几个创作型小节**不算兜底**，仍为 false。
- `derived_outline` 只承载技术规范书、采购需求、评分办法派生出来的内容组织建议，不改变
  `required_outline.sections` 的原始章节、顺序和编号。
  `derived_outline.requirement_groups` 用于归并服务内容、交付成果、质量验收、保密、知识产权、人员稳定等同类要求；
  `derived_outline.section_expansions` 用于说明这些要求应扩写到哪个法定章节；
  `target_section` 必须来自 `required_outline.sections[].title`，找不到映射时写入 `unmapped_requirements`。
- `bidder_outline_profile` 只影响 `creative_required:true` 的二/三级组织方式，不得替换、增删或重排
  `required_outline.sections`；profile 只标明适用类型，不提供真实投标人事实。
- `bidder_knowledge_base` 是投标人背书型内容来源。案例、业绩、团队、资质、专利、绩效、设备、平台、
  服务承诺等增强项必须先查知识库；查不到、缺证明或状态不可用时写 `待填(来源:...)`，不得编造。
- `requirements` 是给人看的"要求矩阵"：每条都要有原文位置和优先级。
  优先级：**A=否决/无效/实质性（先保命）**，B=评分项，C=履约/合同风险，D=格式呈现。
- **否定式准入红线易漏**：「不接受委托中介/中间人代行办理或编制投标文件」「不接受联合体投标」「不接受备选方案/多份报价」等否定式准入条款须扫全并入 `mandatory_clauses`，勿因措辞是「不接受…」而漏抽。
- `★`→`veto:true`；`▲`→`veto:false`。`weight` 之和应为 100，不等则在顶层加 `notes` 说明。
- **JSON 真自检**：分块产出每个 part 写盘前，把中文文本值里的半角 `"` `'` 改写为中文弯引号 `“”`/`‘’`，
  并逐字确认能被 `json.loads` 解析（结构引号成对、字符串内无裸半角引号）；不产坏 JSON 才是根治，merge 的 per-part 定位只是兜底。
- 抽不到填 `null` 并在 `notes` 说明，绝不臆造数字/日期。澄清/补遗替代的原条款要在 `amendments` 标注。
