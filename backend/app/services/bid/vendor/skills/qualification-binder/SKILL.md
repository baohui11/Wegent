---
name: qualification-binder
description: 管理标书正文里的占位符与企业知识库的绑定——校验占位符是否悬空/过期，并在装订前用知识库把占位符替换成最终稿、自动生成附件清单。当需要"绑定企业资质""替换占位符""核对证照有效期""生成附件清单""装订最终稿"时使用。
---

# qualification-binder

正文里所有"需要知识库填充"的地方都用占位符表示，**枪手不许直接写公司名/证书号**。
本技能负责把占位符与 `corpus/qualifications.json` 绑定：先校验、再替换、并产出附件清单。

## 两类占位符（约定）

| 占位符 | 含义 | 解析规则 |
|---|---|---|
| `{{bidder}}` | 投标人标识（"投标人/由谁实施/由谁负责"等身份引用） | **暗标(blind_bid=true)→"我方"**（防泄密）；非暗标→`corpus.company` 公司名 |
| `{{qual:ID}}` | 资质/材料的证据引用 | 解析为「（见附件N）」，N 按首次出现顺序自动编号，同一 ID 复用同一附件号 |

写法要点：正文里把材料名写成**可读文字**，占位符只作交叉引用。
例：`已通过 CMMI3 过程评估{{qual:CMMI3}}` → 装订后 `已通过 CMMI3 过程评估（见附件3）`。

## 1. 校验（起草/审稿阶段）
```
python3 scripts/validate_quals.py --sections workspace/sections \
  --corpus corpus/qualifications.json --tender workspace/tender.json
```
检查：悬空占位符（ID 不在知识库）、过期资质被引用。输出 `{ok, used, issues}`。

## 2. 解析/绑定（装订阶段，关键步骤）
```
python3 scripts/resolve_quals.py --sections workspace/sections \
  --corpus corpus/qualifications.json --tender workspace/tender.json \
  --out-sections workspace/final --attachments workspace/attachments.md
```
- 用知识库把 `{{bidder}}`、`{{qual:ID}}` 替换成最终稿，写入 `workspace/final/`；
- 自动生成 `workspace/attachments.md` 附件清单（附件号 ↔ 材料名 ↔ 文件）；
- **硬闸门**：引用了不存在的 ID、引用了过期资质、或替换后仍残留任何 `{{...}}`，即报错退出（退出码 1）。

这一步把"占位符落到真实知识库"变成确定性动作——这正是之前漏替换问题的修复点：装订必须先 resolve，再拼装。
