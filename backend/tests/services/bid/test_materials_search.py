# SPDX-License-Identifier: Apache-2.0
from app.services.bid import materials_search as msearch
from app.services.bid.workspace import BidWorkspace


def _ws(tmp_path):
    return BidWorkspace("mat-search", root=tmp_path)


def _write_material(ws, name, text):
    p = ws.path(f"corpus/materials/{name}.md")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def test_read_returns_full_text(tmp_path):
    ws = _ws(tmp_path)
    _write_material(ws, "cert.txt", "公司具备一级资质，注册资本一亿元。")
    assert msearch.read(ws, "cert.txt") == "公司具备一级资质，注册资本一亿元。"


def test_read_range_returns_slice(tmp_path):
    ws = _ws(tmp_path)
    _write_material(ws, "cert.txt", "0123456789")
    assert msearch.read(ws, "cert.txt", (2, 5)) == "234"


def test_read_unknown_or_traversal_name_returns_empty(tmp_path):
    ws = _ws(tmp_path)
    _write_material(ws, "cert.txt", "x")
    assert msearch.read(ws, "missing.txt") == ""
    assert msearch.read(ws, "../../etc/passwd") == ""


def _seed_scoped(ws, materials):
    from app.services.bid import materials_service

    materials_service.write_briefs(ws, {"briefs": {}, "materials": materials})


def test_search_ranks_and_scopes(tmp_path):
    ws = _ws(tmp_path)
    _write_material(
        ws, "quality.md", "本公司通过 ISO9001 质量管理体系认证，质量管理制度健全。"
    )
    _write_material(ws, "safety.md", "安全生产责任制度与应急预案完善。")
    _seed_scoped(
        ws,
        [
            {
                "id": "m1",
                "name": "quality.md",
                "linkedNodeIds": ["s1"],
                "scope": "linked",
            },
            {
                "id": "m2",
                "name": "safety.md",
                "linkedNodeIds": ["s2"],
                "scope": "linked",
            },
        ],
    )
    hits = msearch.search(ws, "质量管理体系", "s1")
    assert hits and hits[0]["material"] == "quality.md"
    assert "source" in hits[0] and hits[0]["snippet"]
    # safety.md is scoped to s2 only -> invisible to s1
    assert all(h["material"] != "safety.md" for h in hits)


def test_search_excludes_out_of_scope_material(tmp_path):
    ws = _ws(tmp_path)
    _write_material(ws, "safety.md", "安全生产责任制度与应急预案完善。")
    _seed_scoped(
        ws,
        [{"id": "m2", "name": "safety.md", "linkedNodeIds": ["s2"], "scope": "linked"}],
    )
    assert msearch.search(ws, "安全生产", "s1") == []  # not visible to s1


def test_search_global_material_visible_everywhere(tmp_path):
    ws = _ws(tmp_path)
    _write_material(
        ws, "corp.md", "华信数智是国家级高新技术企业，研发投入占比超百分之十。"
    )
    _seed_scoped(
        ws, [{"id": "m3", "name": "corp.md", "linkedNodeIds": [], "scope": "global"}]
    )
    hits = msearch.search(ws, "高新技术企业", "any-node")
    assert hits and hits[0]["material"] == "corp.md"
