---
name: bid-assembler
description: 装订投标文件——把 resolve_quals 产出的最终稿(workspace/final)、报价表与附件截图装配成可编辑 Word 文档，每个资质/材料截图作为图片插到文末附件页。当需要"装订标书""生成投标 Word""把附件截图插入 word""出最终投标文件"时使用。
---

# bid-assembler

流水线最后一步"装订"。**前置**：必须先跑 `qualification-binder` 的 `resolve_quals.py`，
把占位符替换成最终稿并生成附件清单（`workspace/final/` + `workspace/attachments.json`）。

## 用法
```
# 需要 python-docx：pip install python-docx
python3 scripts/assemble_bid.py \
  --final workspace/final \
  --outline workspace/outline.json \
  --tender workspace/tender.json \
  --attachments workspace/attachments.json \
  --figures workspace/figures-wan/manifest.json \
  --root . \
  --out workspace/投标文件.docx
```
> 正式装订消费的是经 wan 生图 + 核验 + 降级后的 **`workspace/figures-wan/manifest.json`**，
> 不是图表绘制师初版的 `workspace/figures/manifest.json`（编排见 `bid-boss.md` 第 5 步）。
> `--figures` 是通用入参，可指向任何符合契约的 manifest。

## 产物
一份可编辑 `.docx`：
- 封面（暗标下不含投标人名称）；
- 正文：按 `outline.json` 顺序拼接 `workspace/final/*.md`（支持标题/段落/表格，如偏离表、报价表）；
- **附件页**：按 `attachments.json` 顺序，每个附件一页，标题「附件N：材料名」+ **嵌入对应截图图片**。

## 附件截图从哪来
附件图片路径取自 `corpus/qualifications.json` 的 `file` 字段（指向 `corpus/attachments/*.png`）。
这些截图由 AI 图片生成（营业执照、ISO/CMMI 证书、社保证明等），放入 `corpus/attachments/`。
**截图缺失不报错**：自动留"附件截图待补"占位，补图后重跑装订即可。

支持 png/jpg 等位图；图片按页宽约 6.2 英寸居中插入。

## 配图插入与降级（figure 规格块 → PNG / Word 批注）

若传入 `--figures workspace/figures-wan/manifest.json`（或任何符合契约的 manifest），装订脚本会读取图表 manifest：
- 单图 `status=ok` 且 PNG 文件存在时，优先在 `figure` 位置插入 PNG，并写图注。
- PNG 缺失、`status != ok` 或图片插入异常时，不中断装订，自动降级为原有「配图占位段 + Word 批注」。
- 不传 `--figures` 时，完全保持旧行为。
- 为兼容历史产物，装订脚本会把 `render_status=PASS` 规范化为 `status=ok`，但新产物必须写 canonical `status`。
- 装订输出会打印「图表 插入X张 / 降级Y张 / 跳过Z张」；插入数小于 `status=ok` 且 PNG 存在的数量时必须排查。
- 图片段落会显式使用单倍行距并清除首行缩进，避免继承正文固定 28 磅行距导致 Word 裁图。

## 配图占位（figure 规格块 → Word 批注）
正文里的 ```` ```figure ```` 规格块（由枪手就地写、resolve 阶段原样穿过）在装订时渲染为：
- **可见占位段**：底纹 + 醒目色「【配图占位 FIG-X：图题】」，用户在 Word 里一眼可见；
- **Word 批注**：完整图像规格（type/content/data/layout/caption 等）挂在该段上，author=「标书智能体」，供后续生成读取；
- **图注占位**：占位段下方灰色斜体图注，待生成图像后替换。
