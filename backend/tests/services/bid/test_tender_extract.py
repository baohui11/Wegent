# SPDX-License-Identifier: Apache-2.0
import io

import pytest

from app.services.bid.tender_extract import TenderExtractError, extract_text

LONG = "招标文件正文，第一章 项目概述。" * 10  # comfortably above the min-chars gate


def _docx_bytes(paragraphs: list[str]) -> bytes:
    from docx import Document

    doc = Document()
    for p in paragraphs:
        doc.add_paragraph(p)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _blank_pdf_bytes() -> bytes:
    from PyPDF2 import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_txt_utf8_and_gbk():
    assert extract_text("a.txt", LONG.encode("utf-8")) == LONG
    assert extract_text("a.txt", LONG.encode("gb18030")) == LONG


def test_md_passthrough():
    assert "第一章" in extract_text("a.md", ("# 第一章\n" + LONG).encode("utf-8"))


def test_docx_paragraphs():
    text = extract_text("标书.docx", _docx_bytes([LONG, "第二段"]))
    assert "项目概述" in text and "第二段" in text


def test_blank_pdf_rejected_as_scanned():
    with pytest.raises(TenderExtractError, match="文字版"):
        extract_text("scan.pdf", _blank_pdf_bytes())


def test_unsupported_extension():
    with pytest.raises(TenderExtractError, match="unsupported"):
        extract_text("a.doc", b"legacy word binary")


def test_too_short_rejected():
    with pytest.raises(TenderExtractError):
        extract_text("a.txt", "短".encode("utf-8"))


# --- extract_stats (deterministic per-attachment stats) ---


from app.services.bid.tender_extract import extract_stats  # noqa: E402


def _docx_with_table_and_image() -> bytes:
    from docx import Document

    doc = Document()
    doc.add_paragraph("投标人具备完善的项目实施能力。" * 5)
    doc.add_table(rows=2, cols=3)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_extract_stats_docx_counts_tables_and_chars():
    stats = extract_stats("cap.docx", _docx_with_table_and_image())
    assert stats is not None
    assert stats["tables"] == 1
    assert stats["chars"] >= 30
    assert stats["images"] == 0
    assert stats["pages"] == 0  # docx has no fixed page count


def test_extract_stats_txt_counts_chars():
    stats = extract_stats("note.txt", LONG.encode("utf-8"))
    assert stats == {"chars": len(LONG), "pages": 0, "tables": 0, "images": 0}


def test_extract_stats_unsupported_or_scanned_returns_none():
    assert extract_stats("photo.png", b"\x89PNG...") is None
    assert extract_stats("empty.txt", b"  ") is None  # below min-chars
