# SPDX-License-Identifier: Apache-2.0
"""Per-project workspace (blackboard) file IO with path-traversal guard."""

import json
from pathlib import Path

from app.core.config import settings


class BidWorkspace:
    def __init__(self, workspace_ref: str, root: Path | None = None) -> None:
        self._root = (
            Path(root) if root is not None else Path(settings.BID_WORKSPACE_ROOT)
        )
        self._ref = workspace_ref

    def dir(self) -> Path:
        d = self._root / self._ref
        d.mkdir(parents=True, exist_ok=True)
        return d

    def path(self, rel: str) -> Path:
        base = self.dir().resolve()
        target = (base / rel).resolve()
        if not target.is_relative_to(base):
            raise ValueError(f"path traversal rejected: {rel}")
        return target

    def write_tender_text(self, text: str) -> Path:
        p = self.path("inputs/final/tender.txt")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def read_json(self, rel: str) -> dict:
        return json.loads(self.path(rel).read_text(encoding="utf-8"))

    def write_json(self, rel: str, data: dict) -> Path:
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return p

    def read_text_files(self, rel_dir: str) -> dict[str, str]:
        d = self.path(rel_dir)
        if not d.is_dir():
            return {}
        return {
            f.name: f.read_text(encoding="utf-8")
            for f in sorted(d.iterdir())
            if f.is_file()
        }
