# SPDX-License-Identifier: Apache-2.0
import shutil
from pathlib import Path

from app.services.bid import outline_pipeline as op
from app.services.bid.workspace import BidWorkspace

FIX = Path(__file__).parent.parent.parent / "fixtures" / "bid"


def test_build_outline_produces_outline(tmp_path):
    ws = BidWorkspace("outline-smoke", root=tmp_path)
    (ws.dir() / "workspace").mkdir(parents=True)
    shutil.copy(FIX / "tender.json", ws.path("workspace/tender.json"))
    op.run_build_outline(ws)
    outline = ws.read_json("workspace/outline.json")
    assert isinstance(outline.get("sections"), list) and outline["sections"]
    assert "volumes" in outline
