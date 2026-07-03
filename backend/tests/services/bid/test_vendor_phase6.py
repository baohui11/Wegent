# SPDX-License-Identifier: Apache-2.0
"""Smoke: vendored phase-6 skill entry scripts import & expose --help."""

import subprocess
import sys
from pathlib import Path

from app.services.bid import parse_pipeline

_VENDOR = Path(parse_pipeline.__file__).parent / "vendor" / "skills"

_ENTRIES = [
    _VENDOR / "bid-auditor" / "scripts" / "run_audit.py",
    _VENDOR / "qualification-binder" / "scripts" / "resolve_quals.py",
    _VENDOR / "bid-assembler" / "scripts" / "assemble_bid.py",
]


def test_vendored_entry_scripts_exist():
    for e in _ENTRIES:
        assert e.exists(), f"missing vendored script: {e}"


def test_vendored_entry_scripts_import_and_help():
    # --help runs AFTER module-level imports resolve; returncode 0 proves the
    # whole import closure (13 auditor checks / dates / python-docx) is intact.
    for e in _ENTRIES:
        p = subprocess.run(
            [sys.executable, str(e), "--help"], capture_output=True, text=True
        )
        assert p.returncode == 0, f"{e.name} --help failed:\n{p.stderr}"
