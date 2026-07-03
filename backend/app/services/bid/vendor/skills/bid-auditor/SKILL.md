---
name: bid-auditor
description: 标书确定性体检（A级红线 + 一致性检查）：跑评分项覆盖、数字一致、暗标泄密、必备材料、残留占位符等硬校验并汇总报告。当需要"审稿""废标风险检查""红线复核""标书体检""一致性检查""评分项覆盖核对"时使用。
---

# bid-auditor

整套流程的**硬约束守门人**，对应《提取经验》里的"先红线后得分"——这里跑的就是 A 级红线清单与一致性检查。
全部是确定性脚本，读 `workspace/` 产物吐 JSON，**不依赖大模型判断**；它同时是迭代时的 eval 标尺。

## 聚合运行（废标克星用这个）
```
python3 scripts/run_audit.py \
  --tender workspace/tender.json --outline workspace/outline.json \
  --sections workspace/sections --pricing workspace/pricing.json \
  --corpus corpus/qualifications.json \
  --inputs workspace/tender_segments --manifest workspace/tender_manifest.json \
  --tasks-out workspace/_fidelity_tasks.json \
  --out workspace/audit_report.json
```
退出码：有 `veto:true` → 2；有 high 无 veto → 1；全过 → 0。

可选/默认参数：
- `--knowledge-base corpus/bidder_knowledge_base.json`（默认即此值）：知识库接地 / 背书 check 用。
- `--bid-config corpus/bid_config.json`（默认即此值）：分包 `target_package` check 用。
- `--inputs workspace/tender_segments` + `--manifest workspace/tender_manifest.json`：招标原文与分段清单，供 `source_fidelity` 红线召回对账、点数员判目录是否被截断。
- `--tasks-out workspace/_fidelity_tasks.json`：把「确定性够不着」的保真疑点写出给核稿官。
- `--verdicts workspace/_fidelity_verdicts_*.json`：复跑时注入核稿官裁决，折算进结论。
- `--final workspace/final`：装订后指向最终稿，加做残留占位符检查。

`--inputs/--manifest/--tasks-out/--verdicts` 是「双层验证」闭环参数：第一遍跑出 `_fidelity_tasks.json` 交核稿官，
核稿官产出 verdicts 后复跑追加 `--verdicts` 折算（编排见 `bid-boss.md` 第 4 步）。

## 各项检查（也可单独运行，run_audit 聚合调用全部 13 个）
| 脚本 | 查什么 | 对应红线/一致性 |
|---|---|---|
| `check_coverage.py` | 每条评分项被章节覆盖；★废标条款必须覆盖；must_keep 词出现在对应正文 | 实质性条款全响应、评分不漏项 |
| `check_numbers.py` | 报价表合计 = 投标函金额 = 正文金额 | 报价前后一致（常见废标点） |
| `scan_blind.py` | 暗标正文里的公司名/品牌/电话等可识别信息 | 暗标泄密 |
| `check_checklist.py` | 必备材料齐全 + 证照在投标截止日仍有效 | 资格/材料红线 |
| `check_style.py` | 文风体检：称谓违规(采购方/我司…)、响应标签矩阵、figure 裸泄漏(high)；自创方法名/四字并列/三段式/bullet 主导/空词/极致承诺数值一致(medium) | 内容+文风双达标（对应 style-zhongda.md 自查阈值） |
| `check_outline_quality.py` | required_outline 与 outline 主目录契约、前置响应索引表、非格式自拟章节子结构来源 | 目录骨架质量（P0） |
| `check_commitment_terms.py` | 人员更换、响应时限、售后期限等服务承诺数值口径一致性 | 承诺口径一致 |
| `check_knowledge_base.py` | outline 引用的案例/团队/专利/业绩等知识库素材是否已核验或有待填兜底 | 背书素材接地 |
| `check_source_fidelity.py` | 红线条款是否忠于招标原文（结合核稿官 verdicts） | 抽取保真（红线召回对账） |
| `check_endorsement_grounding.py` | 正文背书事实在投标人知识库是否有 verified 出处（结合核稿官 verdicts） | 写作背书接地 |
| `check_structured_completeness.py` | 索引表/偏离表等结构化要素是否完整 | 结构完整性 |
| `check_target_package.py` | 分包锁定与权重/价格公式/rubric 代号一致性 | 分包(target_package) |
| `check_placeholders.py` | 最终稿(`--final`)残留 `{{...}}` | 占位符必须已用知识库替换 |

每个脚本输出 `{check, ok, issues:[{desc, severity, veto, ...}]}`。
`check_source_fidelity` / `check_endorsement_grounding` 在确定性闸门外接收核稿官（大模型）经 `--verdicts` 注入的裁决，
其余 check 为纯确定性脚本；合规/废标判定仍以本报告为准。
AI 输出必须人工复核的内容（否决项、实质性条款、报价、签章、保证金等）以本报告为清单依据。
