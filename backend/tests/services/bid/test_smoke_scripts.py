# SPDX-License-Identifier: Apache-2.0
import shutil
from pathlib import Path

from app.services.bid import parse_pipeline as pp
from app.services.bid.workspace import BidWorkspace

FIX = Path(__file__).parent.parent.parent / "fixtures" / "bid"


def test_run_segment_produces_manifest(tmp_path):
    ws = BidWorkspace("smoke-seg", root=tmp_path)
    shutil.copytree(FIX / "inputs", ws.dir() / "inputs")
    pp.run_segment(ws)
    assert ws.path("workspace/tender_manifest.json").exists()
    assert ws.path("workspace/tender_segments").is_dir()


def test_run_merge_on_consistent_parts(tmp_path):
    ws = BidWorkspace("smoke-merge", root=tmp_path)
    shutil.copytree(FIX / "tender_parts", ws.dir() / "workspace" / "tender_parts")
    code, out = pp.run_merge(ws)
    assert code == 0, out
    assert "scoring" in ws.read_json("workspace/tender.json")
