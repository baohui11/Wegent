# SPDX-License-Identifier: Apache-2.0
import pytest

from app.services.bid import materials_service as ms
from app.services.bid.workspace import BidWorkspace


def test_knowledge_base_roundtrip_and_validation(tmp_path):
    ws = BidWorkspace("m1", root=tmp_path)
    ms.write_knowledge_base(ws, {"bidder_knowledge_base": {"cases": [{"name": "X"}]}})
    kb = ms.read_knowledge_base(ws)
    assert kb["bidder_knowledge_base"]["cases"][0]["name"] == "X"
    with pytest.raises(ValueError):
        ms.write_knowledge_base(ws, {"wrong_top_key": {}})


def test_qualifications_roundtrip_and_validation(tmp_path):
    ws = BidWorkspace("m2", root=tmp_path)
    ms.write_qualifications(
        ws, {"company": "好大一家", "items": [{"id": "Q1", "name": "ISO9001"}]}
    )
    q = ms.read_qualifications(ws)
    assert q["items"][0]["id"] == "Q1"
    with pytest.raises(ValueError):
        ms.write_qualifications(ws, {"company": "x"})  # missing items
    with pytest.raises(ValueError):
        ms.write_qualifications(ws, {"items": {"Q1": {}}})  # dict, not list


def test_read_missing_raises(tmp_path):
    ws = BidWorkspace("m3", root=tmp_path)
    with pytest.raises(FileNotFoundError):
        ms.read_knowledge_base(ws)


def test_save_and_list_attachment(tmp_path):
    ws = BidWorkspace("m4", root=tmp_path)
    info = ms.save_attachment(ws, "iso9001.pdf", b"PDFDATA")
    assert info == {"name": "iso9001.pdf", "size": 7}
    assert ms.list_attachments(ws) == [{"name": "iso9001.pdf", "size": 7}]


def test_attachment_filename_is_basenamed(tmp_path):
    ws = BidWorkspace("m5", root=tmp_path)
    # path components in the name are stripped -> stored flat, no traversal
    info = ms.save_attachment(ws, "../../evil.pdf", b"x")
    assert info["name"] == "evil.pdf"
    assert (ws.dir() / "corpus" / "attachments" / "evil.pdf").exists()
    with pytest.raises(ValueError):
        ms.save_attachment(ws, "/", b"x")  # empty basename


def test_list_attachments_empty_when_absent(tmp_path):
    assert ms.list_attachments(BidWorkspace("m6", root=tmp_path)) == []
