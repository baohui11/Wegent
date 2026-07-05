# SPDX-License-Identifier: Apache-2.0
from unittest.mock import patch

import pytest

from app.services.bid import materials_store as ms
from app.services.bid.workspace import BidWorkspace


def _ws(tmp_path):
    return BidWorkspace("mat-store", root=tmp_path)


def test_ingest_attachment_extracts_text_and_writes_manifest(tmp_path):
    ws = _ws(tmp_path)
    ws.path("corpus/attachments/a.txt").parent.mkdir(parents=True, exist_ok=True)
    ws.path("corpus/attachments/a.txt").write_bytes("公司简介 内容".encode("utf-8"))

    with patch.object(ms, "extract_text", return_value="公司简介 内容"):
        out = ms.ingest_attachment(ws, "a.txt")

    assert out == {"name": "a.txt", "status": "ok", "chars": len("公司简介 内容")}
    assert (
        ws.path("corpus/materials/a.txt.md").read_text(encoding="utf-8")
        == "公司简介 内容"
    )
    man = ms.read_manifest(ws)
    assert man["a.txt"]["status"] == "ok" and man["a.txt"]["chars"] > 0


def test_ingest_attachment_empty_text_marks_empty_not_failed(tmp_path):
    ws = _ws(tmp_path)
    ws.path("corpus/attachments/scan.pdf").parent.mkdir(parents=True, exist_ok=True)
    ws.path("corpus/attachments/scan.pdf").write_bytes(b"%PDF-1.4 no text layer")

    with patch.object(ms, "extract_text", return_value="   "):
        out = ms.ingest_attachment(ws, "scan.pdf")

    assert out["status"] == "empty"
    assert ms.read_manifest(ws)["scan.pdf"]["status"] == "empty"


def test_ingest_attachment_extract_error_marks_failed_not_crash(tmp_path):
    from app.services.bid.tender_extract import TenderExtractError

    ws = _ws(tmp_path)
    ws.path("corpus/attachments/x.docx").parent.mkdir(parents=True, exist_ok=True)
    ws.path("corpus/attachments/x.docx").write_bytes(b"broken")

    with patch.object(ms, "extract_text", side_effect=TenderExtractError("bad")):
        out = ms.ingest_attachment(ws, "x.docx")

    assert out["status"] == "failed"
    assert ms.read_manifest(ws)["x.docx"]["status"] == "failed"


def test_ingest_all_processes_every_attachment(tmp_path):
    ws = _ws(tmp_path)
    for n in ("a.txt", "b.txt"):
        ws.path(f"corpus/attachments/{n}").parent.mkdir(parents=True, exist_ok=True)
        ws.path(f"corpus/attachments/{n}").write_bytes(b"hi")
    with patch.object(ms, "extract_text", return_value="hi there"):
        res = ms.ingest_all(ws)
    assert res == {"a.txt": "ok", "b.txt": "ok"}


def test_read_manifest_missing_returns_empty(tmp_path):
    assert ms.read_manifest(_ws(tmp_path)) == {}


def _seed_briefs_materials(ws, materials):
    from app.services.bid import materials_service

    materials_service.write_briefs(ws, {"briefs": {}, "materials": materials})


def test_materials_for_global_visible_everywhere(tmp_path):
    ws = _ws(tmp_path)
    _seed_briefs_materials(
        ws, [{"id": "m1", "name": "cert.txt", "linkedNodeIds": [], "scope": "global"}]
    )
    ws.path("corpus/materials/cert.txt.md").parent.mkdir(parents=True, exist_ok=True)
    ws.path("corpus/materials/cert.txt.md").write_text(
        "资质正文" * 500, encoding="utf-8"
    )

    got = ms.materials_for(ws, "any-node")
    assert len(got) == 1
    assert got[0]["name"] == "cert.txt" and got[0]["scope"] == "global"
    assert 0 < len(got[0]["summary"]) <= 800


def test_materials_for_linked_only_visible_to_its_nodes(tmp_path):
    ws = _ws(tmp_path)
    _seed_briefs_materials(
        ws,
        [{"id": "m2", "name": "case.txt", "linkedNodeIds": ["s1"], "scope": "linked"}],
    )
    assert [m["name"] for m in ms.materials_for(ws, "s1")] == ["case.txt"]
    assert ms.materials_for(ws, "s2") == []


def test_materials_for_missing_scope_defaults_linked(tmp_path):
    ws = _ws(tmp_path)
    _seed_briefs_materials(ws, [{"id": "m3", "name": "x.txt", "linkedNodeIds": ["s1"]}])
    assert [m["name"] for m in ms.materials_for(ws, "s1")] == ["x.txt"]
    assert ms.materials_for(ws, "s2") == []
