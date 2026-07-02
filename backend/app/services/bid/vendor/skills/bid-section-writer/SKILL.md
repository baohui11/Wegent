---
name: bid-section-writer
description: 起草标书技术/商务章节，按逐条响应+证据闭环组织，用占位符引用知识库、按中大风格去 AI 味。当需要"写标书章节""生成技术方案""起草投标正文""逐条响应""偏离表"时使用。
---

# bid-section-writer

为单个章节生成正文，写入 `workspace/sections/<section_id>.md`。方法遵循《提取经验》第 11–12 节。

## 输入
`section_id`、标题、需覆盖的 `scoring` id、`must_keep` 词条、`mandatory_clauses`(★/▲)、语料目录 `corpus/`。

## 规划阶段（骨架优先）
规划不得套用通用"第一章/第二章"模板。规划命令必须区分生产命令和演示/人工确认兜底命令。

> 命令里的 `$SKILLS_DIR` 是技能根目录（opencode 本地 = `.opencode/skills`，Wegent = `~/.claude/skills`；PowerShell 写 `$env:SKILLS_DIR`），不要写死成绝对路径或 `.opencode/` 测试布局。

### 生产命令
用于 `workspace/tender.json` 已含 `required_outline` 的情况；缺字段必须阻断并回到拆标阶段，不能静默 fallback。

```powershell
python $SKILLS_DIR/bid-section-writer/scripts/build_outline.py `
  --tender workspace/tender.json `
  --skeleton $SKILLS_DIR/bid-section-writer/references/outline_skeleton.json `
  --profile $SKILLS_DIR/bid-section-writer/references/bidder_outline_profile_ke-gai.json `
  --knowledge-base corpus/bidder_knowledge_base.json `
  --out workspace/outline.json `
  --sections-out workspace/sections
```

### 演示/人工确认兜底命令
仅用于同兴案/科改辅导同类骨架已人工确认，或干净种子工作区暂未提交 `required_outline` 但需要跑通演示时。此命令必须显式增加 `--allow-skeleton-fallback`，不得作为生产默认命令。

```powershell
python $SKILLS_DIR/bid-section-writer/scripts/build_outline.py `
  --tender workspace/tender.json `
  --skeleton $SKILLS_DIR/bid-section-writer/references/outline_skeleton.json `
  --profile $SKILLS_DIR/bid-section-writer/references/bidder_outline_profile_ke-gai.json `
  --knowledge-base corpus/bidder_knowledge_base.json `
  --out workspace/outline.json `
  --sections-out workspace/sections `
  --allow-skeleton-fallback
```

- `outline.sections` 只放技术文件主干：两张前置响应索引表 + 招标文件法定技术文件目录。
- 商务、资格、报价写入 `outline.volumes` 独立分册，只参与 covers 覆盖校验，不进入技术文件"一、二、三…"编号序列。
- 一级编号用"一、二、三"，二级用"（一）（二）"，三级用"1. 2. 3."；不得出现重复"第一章"。
- 偏离表只能作为章末小节或附录，不进入技术文件主目录。
- 生产环境中，`tender.required_outline` 缺失必须阻断并回到拆标阶段；不得默认套用 `outline_skeleton.json`。
- `outline_skeleton.json` 只用于同兴案/科改辅导类骨架已被人工确认时的演示兜底，启用时必须显式加 `--allow-skeleton-fallback`。

### 固定子结构
- 三、对项目的理解：`（一）项目背景` 按"国家→国家电网公司→省公司→集团→企业"五层递进，
  `（二）项目重难点分析及应对措施` 下分重点、难点。
- 四、工作规划描述：服务目标、服务范围与要求、项目总体思路、项目整体计划、服务成果交付与验收。
- 五、履约能力及质量保证措施：履约能力、工作进度保证措施、质量保证措施、知识产权管理、保密机制。
- 七、支撑材料：逐项对应技术评分标准，形成评委可定位的得分锚点。

### 投标人背书型内容
- `outline.sections[].knowledge_briefs` 是写作前必须读取的知识库检索任务；枪手动笔前先按任务检查 `corpus/bidder_knowledge_base.json`，再决定哪些素材可写入正文。
- 项目案例、业绩文件、团队成员、履约能力、服务承诺增强项、设备设施、专利、绩效评价等，均属于投标人背书型内容。
- 背书型内容必须优先引用 `corpus/bidder_knowledge_base.json` 中 `verification_status: verified` 的素材，并把可核验证据落到正文或附件引用。
- 素材为 `pending`、`missing` 或不存在时，只能保留 `待填(来源:...)`；不得写公司规模、专利号、案例客户、绩效等级、设备数量或承诺数值。

## 逐条响应 + 证据闭环（核心）
不要只写"满足/完全响应"。每条要求在心里答全五件事——**要求实质 → 我方做法 → 如何满足（具体做法/数字/时序）→ 证明材料（附件引用）→ 是否偏离**。但这是**脑子里的覆盖清单，不是写进正文的句式**：

- **正文不回显需求/评分 ID、不照抄招标原文**：不写"针对评分项 S3："、"针对 R019："、"原文要求：…"，不把招标原文整句塞进括号。ID 对应关系只进**前置响应索引表**与**偏离表**；段首自然切入主旨、句式多样，覆盖了哪条要求由索引表承载。（`check_style` 会以 high 拦截正文回显。）
- **实质性(★)条款不得出现负偏离**；需要列偏离时用偏离表：`| 序号 | 招标要求 | 我方响应 | 偏离情况 | 证明材料 |`。
- 评分项要做"证据闭环"：每个得分点都要有可被评委快速定位的证明材料（用占位符落到附件）。

## 占位符（不许直接写公司名/证书号，装订时由 resolve_quals 替换）
- `{{bidder}}` —— 投标人身份引用（"投标人/由谁实施"）。暗标下会被替换成"我方"。
- `{{qual:ID}}` —— 资质/材料证据引用，装订后变「（见附件N）」。正文把材料名写成可读文字，占位符只作交叉引用。
  例：`已通过 CMMI3 过程评估{{qual:CMMI3}}`、`售后由 {{bidder}} 负责`。

## 铁律
1. 覆盖分配的每条 scoring，不漏。
2. `must_keep` 词条原样出现在正文。
3. **暗标**：正文绝不能出现投标人名称、品牌、落款、电话等可识别信息——身份一律用 `{{bidder}}`。
4. 不写报价数字（报价在 `workspace/pricing.json`）。

## 配图规划（可绘制 figure brief）

标书需图文并茂。在合理位置规划配图，并在正文就地写一段 ```` ```figure ```` 规格块。该规格块不是简单占位，而是后续 `图表绘制师` 生成 DiagramSpec/SVG/PNG 的输入，必须具备可绘制性：说清楚图要证明什么、有哪些对象、对象之间是什么关系、数据来自哪里、缺什么数据。

**写法**（围栏块，字段固定；不要用 `{{figure:ID}}`，那会被装订前的占位符闸门误杀）：

````
```figure
id: FIG-2-1
type: 架构图          # 流程图|架构图|示意图|数据图表|组织结构图|矩阵图|甘特时间轴
semantic_family: architecture-boundary
title: 总体技术路线图
purpose: S4 服务方案先进性     # 对齐哪条评分项/锚点
message: 以三阶段九步骤推进科改申报辅导，并与四项交付成果形成对应关系
content: 展示政策解码、评估诊断、方案落地三阶段如何递进推进
nodes:
  - 政策解码：政策归集、政策宣贯、指标解读
  - 评估诊断：资料收集、现场调研、短板分析
  - 方案落地：目标设定、方案编制、台账跟踪
relationships:
  - 政策解码 -> 评估诊断 -> 方案落地
  - 每阶段输出对应交付成果
data:
  - 时间范围：待填(来源:项目计划)
  - 交付成果：解读与分析课件、评估分析报告、年度指标目标、改革方案及工作台账
layout: 横向泳道 + 顶部时间轴
source: 本节正文 + 技术规范书对应条款
caption: 图2-1 项目总体技术路线
```
````

**必填基础字段**：`id/type/semantic_family/title/purpose/message/content/layout/source/caption`。

`semantic_family` 必须从 Golden Gallery 11 类中选择：`process-flow`、`cyclic-control`、`timeline-gantt`、`matrix-grid`、`org-governance`、`hierarchy-capability`、`logic-mechanism`、`architecture-boundary`、`value-flow`、`swimlane-journey`、`comparison-decision`。它是审稿 agent 选择规则的依据，不是模板名；真实生成阶段不让用户逐图选择。

**图型相关字段**：
- 流程图、架构图、组织结构图、分层示意图必须列 `nodes` 和 `relationships`。
- 矩阵图必须列 `rows` 和 `columns`。
- 甘特图、时间轴、路线图必须列 `tasks`，建议列 `milestones`。
- 数据、日期、数量写入 `data`，无真实数据写 `待填(来源:XX)`。
- 需要突出显示的主结论或关键节点写入 `emphasis`。

**禁止**：只写“阶段×3、步骤×9、交付物×4”但不列具体名称；为配图编造未核验事实；把评分/需求 ID 写进正文段落。ID 可以出现在 `purpose/source` 中用于索引与审计。

**配图节奏（对标真实高分技术文件）**：参照真实中标技术文件（正文约 3.2 万字 / 183 图），几乎**每个叶子方法步骤都配一张图**，节奏固定为「小标题 → 几句硬核说明 → ```figure 块」。落到写作：
- 每个最细一层的方法步骤/载体/环节，规划 1 张过程图或示意图，证明「怎么做、产出什么」。
- 枚举式方法（六步法、A/B/C… 六大载体、N 阶段）：总述处先配 1 张框架总览图（流程/架构/逻辑机制），再在关键过程块后逐一配图，不要只在章首放一张大图。
- 案例/业绩章同样图文并茂：业务蓝图、能力地图、设计制品、成效对比都配图。
- 配图量级参照：核心方法章 3–8 张、论述型背景章 2–5 张、服务保障章 2–5 张、纯承诺段一般不配图。

**配图位置规则**（与评分点绑定，配“挣分的图”非“装饰图”）：
- 2.1 总体技术路线 → 总体技术路线图（架构/流程）★必备
- 2.5 工作阶段划分 → 甘特图/时间轴 ★必备
- 3.1 资源与团队保障 → 项目组织架构图 ★必备（对齐团队评分）
- 1.2 客户痛点 → 痛点—诉求对照示意（建议）
- 2.2–2.4 各阶段 → 阶段方法示意/流程（建议）
- 3.3 质量保证 → PDCA/质量控制闭环（建议）；3.4 风险 → 影响—概率矩阵（建议）
- 四、服务承诺 → 一般不配图

## 篇幅与密度（硬要求，文字偏少直接丢分）

对标真实中标技术文件（正文约 3.2 万字 / 183 图）：核心「具体研究方案」单章约 1.3 万字；论述型章节（背景、重难点、理论内涵与工具方法）每章 2000–3000 字；服务保障约 1000 字；案例每个 1300–2500 字。按所写章节给出**最低篇幅**（不足视为未完成）：

- 核心方法/专项服务/总体技术路线：**≥1500 字**，拆成多个方法步骤逐一独立成段。
- 论述型章节（背景、重难点、理论方法、面临形势）：**≥1800 字**，多层递进，每层落到具体政策/现状/诉求。
- 服务保障/承诺/进度：**≥800 字**，写到「谁、何时、做什么、达到什么标准、违约怎么办」。
- 案例/业绩：每个案例 **≥1200 字**，覆盖背景→思路→设计制品→成效（成效给可核验数字，缺则 `待填(来源:XX)`）。

**段落密度**：每个方法步骤/枚举要点都成段展开 **80–180 字**，做到「定位句→具体做法+数字+时序+责任→效果/证据收束」三段式；不要一句话带过一个步骤，也不要压成半行 bullet。核心章节通常含 6–12 个实义段。

## 文风（内容 + 文风 双达标）
动笔前读 `references/style-zhongda.md`（风格圣经）。每段同时满足：**内容硬核**（具体做法+数字+时序+证据）**与** **标书 register**（四六骈偶、引号自创方法名、三段式、维度穷举、极致承诺、称谓"贵司/贵公司·我方/我司"）。去 AI 味=删空词硬黑名单（闭环/抓手 实义放行、勿堆砌），不等于写大白话或满屏 bullet。
