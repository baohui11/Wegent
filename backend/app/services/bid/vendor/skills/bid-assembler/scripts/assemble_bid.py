#!/usr/bin/env python3
"""装订：把最终稿(workspace/final) + 报价表 + 附件截图 装配成可编辑 Word 投标文件。
附件按附件清单(attachments.json)顺序，每个一页：标题「附件N：材料名」+ 嵌入截图图片。
需要 python-docx：pip install python-docx
"""
import argparse
import json
import re
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

SEP_RE = re.compile(r"^\s*:?-{2,}:?\s*$")
TABLE_CAPTION_RE = re.compile(r"^表\s*\d+[\s　].+")
CJK_RE = re.compile(r"[\u3400-\u9fff]")

TITLE_FONT = "方正小标宋"
H1_FONT = "黑体"
H2_FONT = "楷体"
BODY_FONT = "仿宋"
TABLE_BODY_FONT = "宋体"
BODY_SIZE_PT = 16
TITLE_SIZE_PT = 22
TABLE_CAPTION_SIZE_PT = 14
TABLE_HEADER_SIZE_PT = 12
TABLE_BODY_SIZE_PT = 10
TWO_CHAR_PT = BODY_SIZE_PT * 2
FIGURE_STATUS_MAP = {
    "PASS": "ok",
    "OK": "ok",
    "SUCCESS": "ok",
    "NEED_FIX": "need_fix",
    "BLOCKED": "blocked",
    "FAIL": "blocked",
    "FAILED": "blocked",
    "ERROR": "blocked",
}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def load_figure_manifest(path, root):
    if not path:
        return {}
    manifest_path = Path(path)
    if not manifest_path.exists():
        return {}
    data = load(manifest_path)
    figures = {}
    for item in data.get("figures", []) or []:
        fid = item.get("id")
        if not fid:
            continue
        normalized = dict(item)
        status = str(normalized.get("status", "")).strip().lower()
        if status not in {"ok", "blocked", "need_fix"}:
            render_status = str(normalized.get("render_status", "")).strip().upper()
            normalized["status"] = FIGURE_STATUS_MAP.get(render_status, status)
        png = normalized.get("png")
        if png:
            png_path = Path(png)
            if not png_path.is_absolute():
                png_path = root / png_path
            normalized["_png_path"] = str(png_path)
        figures[fid] = normalized
    return figures


def find_attachment_img(root, file_field):
    """按附件 file 字段查找截图，支持 corpus/attachments 目录与 png/jpg 扩展名回退。

    attachments.json 的 file 通常是资质原件名(如 biz_license.pdf)，而实际截图
    存于 corpus/attachments/ 且为 png。这里按 stem 在多个候选目录、多个扩展名中查找。
    """
    if not file_field:
        return None
    stem = Path(file_field).stem
    dirs = [
        root / "corpus" / "attachments",
        root / "corpus",
        root / "corpus" / "attachments" / "self_prepared",
        root,
    ]
    seen = set()
    for d in dirs:
        for ext in (".png", ".jpg", ".jpeg", Path(file_field).suffix):
            if not ext:
                continue
            cand = d / (stem + ext)
            key = str(cand)
            if key in seen:
                continue
            seen.add(key)
            if cand.exists():
                return cand
    return None


def normalize_chinese_punctuation(text):
    if not CJK_RE.search(text):
        return text
    text = re.sub(r"'([^']+)'", r"“\1”", text)
    text = re.sub(r'"([^"]+)"', r"“\1”", text)
    text = text.replace("(", "（").replace(")", "）")
    text = re.sub(r"(?<=[0-9０-９])\.(?=[\u3400-\u9fff])", "．", text)
    text = text.translate(
        str.maketrans(
            {
                ",": "，",
                ";": "；",
                "?": "？",
                "!": "！",
            }
        )
    )
    return re.sub(r"(?<![A-Za-z]):(?!//)", "：", text)


def clean(t):
    return normalize_chinese_punctuation(t.replace("**", "").strip())


def _set_east_asia_font(obj, east_asia, ascii_font=None):
    font = obj.font
    font.name = ascii_font or east_asia
    r_pr = obj._element.get_or_add_rPr()
    r_fonts = r_pr.rFonts
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    r_fonts.set(qn("w:eastAsia"), east_asia)
    r_fonts.set(qn("w:ascii"), ascii_font or east_asia)
    r_fonts.set(qn("w:hAnsi"), ascii_font or east_asia)


def _set_run_font(run, east_asia, size_pt, ascii_font=None, bold=None):
    _set_east_asia_font(run, east_asia, ascii_font=ascii_font)
    run.font.size = Pt(size_pt)
    if bold is not None:
        run.bold = bold


def _set_style_font(style, east_asia, size_pt, ascii_font=None, bold=None):
    _set_east_asia_font(style, east_asia, ascii_font=ascii_font)
    style.font.size = Pt(size_pt)
    if bold is not None:
        style.font.bold = bold


def _set_common_paragraph_format(
    paragraph_format,
    *,
    left_indent=None,
    first_line_indent=None,
    alignment=None,
    space_before=None,
    space_after=None,
    line_spacing=Pt(28),
    exact=True,
):
    if left_indent is not None:
        paragraph_format.left_indent = left_indent
    if first_line_indent is not None:
        paragraph_format.first_line_indent = first_line_indent
    if alignment is not None:
        paragraph_format.alignment = alignment
    if space_before is not None:
        paragraph_format.space_before = space_before
    if space_after is not None:
        paragraph_format.space_after = space_after
    if exact:
        paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    paragraph_format.line_spacing = line_spacing


def _set_paragraph_bottom_border(paragraph):
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = p_pr.find(qn("w:pBdr"))
    if p_bdr is None:
        p_bdr = OxmlElement("w:pBdr")
        p_pr.append(p_bdr)
    bottom = p_bdr.find(qn("w:bottom"))
    if bottom is None:
        bottom = OxmlElement("w:bottom")
        p_bdr.append(bottom)
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "000000")


def _add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    _set_run_font(run, "Times New Roman", 9, ascii_font="Times New Roman")
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def configure_document_defaults(doc):
    """招标文件和用户未指定时使用的默认 Word 排版规则。"""
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(3.7)
    section.bottom_margin = Cm(3.5)
    section.left_margin = Cm(2.8)
    section.right_margin = Cm(2.8)

    normal = doc.styles["Normal"]
    _set_style_font(normal, BODY_FONT, BODY_SIZE_PT)
    _set_common_paragraph_format(
        normal.paragraph_format,
        first_line_indent=Pt(TWO_CHAR_PT),
        space_before=Pt(0),
        space_after=Pt(0),
    )

    title = doc.styles["Title"]
    _set_style_font(title, TITLE_FONT, TITLE_SIZE_PT)
    _set_common_paragraph_format(
        title.paragraph_format,
        alignment=WD_ALIGN_PARAGRAPH.CENTER,
        first_line_indent=Pt(0),
        space_before=Pt(TITLE_SIZE_PT),
        space_after=Pt(TITLE_SIZE_PT),
    )

    heading_specs = {
        "Heading 1": (H1_FONT, BODY_SIZE_PT, True),
        "Heading 2": (H2_FONT, BODY_SIZE_PT, False),
        "Heading 3": (BODY_FONT, BODY_SIZE_PT, False),
        "Heading 4": (BODY_FONT, BODY_SIZE_PT, False),
    }
    for style_name, (font_name, size_pt, bold) in heading_specs.items():
        style = doc.styles[style_name]
        _set_style_font(style, font_name, size_pt, bold=bold)
        _set_common_paragraph_format(
            style.paragraph_format,
            left_indent=Pt(TWO_CHAR_PT),
            first_line_indent=Pt(0),
            space_before=Pt(0),
            space_after=Pt(0),
        )

    header = section.header
    hp = header.paragraphs[0]
    hp.text = ""
    _set_paragraph_bottom_border(hp)

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.text = ""
    _add_page_number(fp)


def add_table_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.first_line_indent = Pt(0)
    p.paragraph_format.line_spacing = 1.0
    run = p.add_run(clean(text))
    _set_run_font(run, BODY_FONT, TABLE_CAPTION_SIZE_PT)


def add_figure_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.first_line_indent = Pt(0)
    p.paragraph_format.line_spacing = 1.0
    run = p.add_run(clean(text))
    _set_run_font(run, BODY_FONT, TABLE_CAPTION_SIZE_PT)
    return run


def format_picture_paragraph(paragraph):
    """图片段落不能继承正文固定行距，否则 Word 会裁剪 inline picture。"""
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fmt = paragraph.paragraph_format
    fmt.first_line_indent = Pt(0)
    fmt.line_spacing_rule = WD_LINE_SPACING.SINGLE
    fmt.line_spacing = 1.0
    fmt.space_before = Pt(6)
    fmt.space_after = Pt(6)


def _set_cell_shading(cell, hex_fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), hex_fill)


def _set_cell_text(cell, text, *, font_name, size_pt, bold=False):
    cell.text = clean(text)
    paragraph = cell.paragraphs[0]
    paragraph.paragraph_format.first_line_indent = Pt(0)
    paragraph.paragraph_format.line_spacing = 1.0
    if not paragraph.runs:
        paragraph.add_run("")
    for run in paragraph.runs:
        _set_run_font(run, font_name, size_pt, bold=bold)


def add_table(doc, tbl_lines):
    rows = []
    for ln in tbl_lines:
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        rows.append(cells)
    rows = [r for r in rows if not all(SEP_RE.match(c or "-") for c in r)]
    if not rows:
        return
    ncol = max(len(r) for r in rows)
    table = doc.add_table(rows=0, cols=ncol)
    table.style = "Table Grid"
    for ri, r in enumerate(rows):
        cells = table.add_row().cells
        for j in range(ncol):
            if ri == 0:
                _set_cell_text(
                    cells[j],
                    r[j] if j < len(r) else "",
                    font_name=BODY_FONT,
                    size_pt=TABLE_HEADER_SIZE_PT,
                    bold=True,
                )
                _set_cell_shading(cells[j], "D9EAF7")
            else:
                _set_cell_text(
                    cells[j],
                    r[j] if j < len(r) else "",
                    font_name=TABLE_BODY_FONT,
                    size_pt=TABLE_BODY_SIZE_PT,
                )


FIG_FIELDS = ["id", "type", "title", "purpose", "content", "data", "layout", "caption"]
FIG_LABEL = {
    "id": "编号",
    "type": "图类型",
    "title": "图题",
    "purpose": "对齐评分点",
    "content": "内容描述",
    "data": "数据/要素",
    "layout": "形态建议",
    "caption": "图注",
}


def _figure_comment(spec, order, header):
    """把 figure 规格块拼成 Word 批注正文。成功插图与降级占位共用，仅 header 不同。"""
    keys = [k for k in FIG_FIELDS if spec.get(k)] + [
        k for k in order if k not in FIG_FIELDS and spec.get(k)
    ]
    return "\n".join([header] + [f"{FIG_LABEL.get(k, k)}：{spec[k]}" for k in keys])


def _set_para_shading(p, hex_fill="FFF2CC"):
    """给段落加底纹，让配图占位在正文里一眼可见。"""
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    pPr.append(shd)


def add_figure(doc, block_lines, figure_manifest=None, figure_stats=None):
    """优先插入已渲染 PNG（图注上仍挂「图像规格」批注，供核对/追溯）；失败时降级为「可见占位段 + Word 批注」。"""
    spec, order = {}, []
    cur = None
    for raw in block_lines:
        ln = raw.rstrip()
        stripped = ln.strip()
        if not stripped:
            continue
        is_subitem = stripped[:1] in "-*"  # 子项/续行（如 "- 外环：..."）
        has_colon = (":" in ln) or ("：" in ln)
        if has_colon and not is_subitem:
            # 兼容中英文冒号：先短路判断 ":" 是否存在，再取 index（避免 ValueError）
            idxs = [ln.index(c) for c in (":", "：") if c in ln]
            sep = ":" if (":" in ln and ln.index(":") == min(idxs)) else "："
            k, v = ln.split(sep, 1)
            k = k.strip().lstrip("-* ").lower()
            spec[k] = v.strip()
            if k not in order:
                order.append(k)
            cur = k
        elif cur is not None:
            # 多行 content/data：无冒号子项或续行，拼到当前字段值，保留进批注
            spec[cur] = (spec[cur] + "\n" + stripped).strip()

    fid = spec.get("id", "FIG")
    title = spec.get("title") or fid

    item = (figure_manifest or {}).get(fid)
    if item and item.get("status") == "ok":
        png = Path(item.get("_png_path") or item.get("png", ""))
        if png.exists():
            try:
                doc.add_picture(str(png), width=Inches(5.9))
                format_picture_paragraph(doc.paragraphs[-1])
                cap_run = add_figure_caption(
                    doc, item.get("caption") or spec.get("caption") or title
                )
                # 成功插图后仍在图注上挂批注，保留图像规格供核对/追溯
                doc.add_comment(
                    runs=[cap_run],
                    text=_figure_comment(spec, order, "【配图规格·供核对】"),
                    author="标书智能体",
                    initials="AI",
                )
                if figure_stats is not None:
                    figure_stats["inserted"] += 1
                return
            except Exception:
                pass
    if figure_stats is not None:
        if item:
            figure_stats["degraded"] += 1
        else:
            figure_stats["skipped"] += 1

    # 可见占位段（底纹 + 醒目色）：用户在 Word 里一眼看到“这里要配图”
    p = doc.add_paragraph()
    _set_para_shading(p)
    run = p.add_run(f"【配图占位 {fid}：{title}】")
    run.bold = True
    run.font.color.rgb = RGBColor(0xC0, 0x50, 0x00)

    # 批注正文 = 完整图像规格（供后续生成读取）
    doc.add_comment(
        runs=[run],
        text=_figure_comment(spec, order, "【后续生成用·图像规格】"),
        author="标书智能体",
        initials="AI",
    )

    # 图注占位（待生成图像后替换）
    cap = spec.get("caption")
    if cap:
        cp = doc.add_paragraph()
        cr = cp.add_run(f"（{cap}　—　待生成图像后替换上方占位）")
        cr.italic = True
        cr.font.color.rgb = RGBColor(0x80, 0x80, 0x80)


def add_markdown(doc, md_text, figure_manifest=None, figure_stats=None):
    lines = md_text.splitlines()
    i, buf = 0, []

    def flush():
        nonlocal buf
        if buf:
            doc.add_paragraph(clean(" ".join(buf)))
            buf = []

    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            flush()
            i += 1
            continue
        # ```figure 规格块 → 配图占位 + 批注
        if line.lstrip().startswith("```"):
            info = line.lstrip()[3:].strip().lower()
            flush()
            i += 1
            block = []
            while i < len(lines) and not lines[i].lstrip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1  # 跳过闭合 ```
            if info == "figure":
                add_figure(
                    doc,
                    block,
                    figure_manifest=figure_manifest,
                    figure_stats=figure_stats,
                )
            else:
                for b in block:
                    if b.strip():
                        doc.add_paragraph(clean(b.strip()))
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading:
            flush()
            doc.add_heading(clean(heading.group(2)), level=len(heading.group(1)))
            i += 1
            continue
        if TABLE_CAPTION_RE.match(line.strip()):
            flush()
            add_table_caption(doc, line.strip())
            i += 1
            continue
        if line.lstrip().startswith("|"):
            flush()
            tbl = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                tbl.append(lines[i])
                i += 1
            add_table(doc, tbl)
            continue
        buf.append(line.strip())
        i += 1
    flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", required=True, help="resolve_quals 产出的最终稿目录")
    ap.add_argument("--outline", required=True)
    ap.add_argument("--tender", required=True)
    ap.add_argument("--attachments", required=True, help="attachments.json")
    ap.add_argument(
        "--figures",
        default=None,
        help="workspace/figures/manifest.json；status=ok 且 PNG 存在时插入图表",
    )
    ap.add_argument("--root", default=".", help="附件图片路径相对的项目根目录")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    tender = load(a.tender)
    outline = load(a.outline)
    attachments = load(a.attachments)
    final = Path(a.final)
    root = Path(a.root)
    figure_manifest = load_figure_manifest(a.figures, root)
    figure_stats = {"inserted": 0, "degraded": 0, "skipped": 0} if a.figures else None

    doc = Document()
    configure_document_defaults(doc)
    proj = tender.get("project", {})

    # 封面（暗标：不放投标人名称）
    title = doc.add_heading(proj.get("name", "投标文件"), level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for line in [
        "投标文件（技术及商务文件）",
        f"项目编号：{proj.get('id', '')}",
        f"预算/最高限价：人民币 {proj.get('budget', '')} 元",
        f"投标截止：{(proj.get('bid_deadline') or '')[:10]}",
    ]:
        p = doc.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.first_line_indent = Pt(0)
    doc.add_page_break()

    # 正文：按 outline 顺序
    missing_sections = []
    for sec in outline.get("sections", []):
        f = final / f"{sec['id']}.md"
        if f.exists():
            # The section body no longer carries its own heading (the heading
            # now lives only in the outline — single-document foundation §6 /
            # spike-notes Conclusion B). Inject the heading from the outline
            # title before rendering the body so export keeps every heading.
            title = str(sec.get("title") or "").strip()
            if title:
                doc.add_heading(clean(title), level=1)
            add_markdown(
                doc,
                f.read_text(encoding="utf-8"),
                figure_manifest=figure_manifest,
                figure_stats=figure_stats,
            )
        else:
            missing_sections.append(sec["id"])
            doc.add_paragraph(f"（章节缺失：{sec['id']}）")

    # 正文：独立分册（商务/资格/报价等，来自 outline.volumes）
    # 跳过技术分册（其 section 已在上方 sections 装订，避免重复）
    volume_section_count = 0
    for vol in outline.get("volumes", []) or []:
        vol_name = vol.get("name", "") or ""
        if vol_name.startswith("技术") or vol_name in ("技术投标文件", "技术文件"):
            continue
        vol_sections = vol.get("sections", []) or []
        if not vol_sections:
            continue
        doc.add_page_break()
        doc.add_heading(vol_name, level=1)
        for sec in vol_sections:
            sid = sec.get("id")
            if not sid:
                continue
            f = final / f"{sid}.md"
            if f.exists():
                # Same title-dedup convention as main sections: bodies are
                # title-less, so inject the heading from the outline title.
                vtitle = str(sec.get("title") or "").strip()
                if vtitle:
                    doc.add_heading(clean(vtitle), level=2)
                add_markdown(
                    doc,
                    f.read_text(encoding="utf-8"),
                    figure_manifest=figure_manifest,
                    figure_stats=figure_stats,
                )
                volume_section_count += 1
            else:
                missing_sections.append(sid)
                doc.add_paragraph(f"（章节缺失：{sid}）")

    # 附件：每个一页，插入截图
    missing_imgs = []
    if attachments:
        doc.add_page_break()
        doc.add_heading("附件", level=1)
        for att in attachments:
            doc.add_page_break()
            doc.add_heading(f"附件{att['no']}：{att['name']}", level=2)
            img = find_attachment_img(root, att.get("file", ""))
            if img:
                try:
                    doc.add_picture(str(img), width=Inches(6.2))
                    format_picture_paragraph(doc.paragraphs[-1])
                except Exception as e:  # noqa
                    doc.add_paragraph(f"（附件图片插入失败：{img} — {e}）")
            else:
                missing_imgs.append(att.get("file", ""))
                ph = doc.add_paragraph(
                    f"（附件截图待补：请将 {att.get('name','')} 截图放入 corpus/attachments/ 后重新装订）"
                )
                ph.runs[0].italic = True

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    doc.save(a.out)

    print(f"已生成 {a.out}")
    print(
        f"  正文章节 {len(outline.get('sections', []))} 个"
        + (f"（缺失：{missing_sections}）" if missing_sections else "（全部就位）")
        + f" + 独立分册章节 {volume_section_count} 个（商务/报价等）"
    )
    if figure_stats is not None:
        print(
            f"  图表 插入{figure_stats['inserted']}张 / "
            f"降级{figure_stats['degraded']}张 / 跳过{figure_stats['skipped']}张"
        )
    print(
        f"  附件 {len(attachments)} 个"
        + (
            f"，其中 {len(missing_imgs)} 个截图未找到（已留占位，补图后重跑即可）"
            if missing_imgs
            else "，截图全部嵌入"
        )
    )


if __name__ == "__main__":
    main()
