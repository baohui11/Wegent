# SPDX-License-Identifier: Apache-2.0
import json
import shutil
from pathlib import Path

from app.services.bid import outline_pipeline as op
from app.services.bid.tender_normalize import (
    normalize_qualifications,
    normalize_required_outline,
)
from app.services.bid.workspace import BidWorkspace

FIX = Path(__file__).parent.parent.parent / "fixtures" / "bid"


def test_normalize_required_outline_coerces_string_items():
    # qwen sometimes emits front_matter as bare strings; build_front_sections
    # calls item.get(...) and would AttributeError. Coerce str -> {"title": str}.
    ro = {"front_matter": ["投标函", {"title": "响应索引表", "type": "index"}]}
    out = normalize_required_outline(ro)
    assert out["front_matter"][0] == {"title": "投标函"}
    assert out["front_matter"][1] == {"title": "响应索引表", "type": "index"}


def test_normalize_qualifications_coerces_string_items():
    out = normalize_qualifications(["财务审计报告", {"desc": "ISO9001"}])
    assert out[0] == {"desc": "财务审计报告"}
    assert out[1] == {"desc": "ISO9001"}
    assert normalize_qualifications(None) is None


def test_normalize_qualifications_flattens_dict_of_lists():
    quals = {
        "basic_qualifications": ["独立法人", {"desc": "营业执照"}],
        "specific_qualifications": ["ISO9001"],
        "joint_venture_allowed": None,
    }
    out = normalize_qualifications(quals)
    assert {"desc": "独立法人"} in out
    assert {"desc": "营业执照"} in out
    assert {"desc": "ISO9001"} in out
    assert all(isinstance(x, dict) for x in out)


def test_normalize_required_outline_handles_list_and_scalar():
    assert normalize_required_outline(["A", {"title": "B"}]) == [
        {"title": "A"},
        {"title": "B"},
    ]
    assert normalize_required_outline(None) is None


def test_build_outline_survives_string_front_matter(tmp_path):
    ws = BidWorkspace("outline-strfm", root=tmp_path)
    (ws.dir() / "workspace").mkdir(parents=True)
    tender = json.loads((FIX / "tender.json").read_text(encoding="utf-8"))
    ro = tender.get("required_outline")
    if isinstance(ro, dict):
        ro["front_matter"] = ["投标函", "法定代表人授权书"]  # bare strings
    tender["required_outline"] = ro
    ws.write_json("workspace/tender.json", tender)
    op.run_build_outline(ws)  # would crash before the normalize fix
    assert ws.read_json("workspace/outline.json")["sections"]


def test_build_outline_produces_outline(tmp_path):
    ws = BidWorkspace("outline-smoke", root=tmp_path)
    (ws.dir() / "workspace").mkdir(parents=True)
    shutil.copy(FIX / "tender.json", ws.path("workspace/tender.json"))
    op.run_build_outline(ws)
    outline = ws.read_json("workspace/outline.json")
    assert isinstance(outline.get("sections"), list) and outline["sections"]
    assert "volumes" in outline
