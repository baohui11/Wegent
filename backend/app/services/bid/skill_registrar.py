# SPDX-License-Identifier: Apache-2.0
"""Register the vendored ``bid-section-writer`` skill as a platform Skill CRD.

The drafting sandbox (Task 6) tells Claude Code SDK to use this skill; the
executor's ``skill_deployer`` downloads it from the backend internal skill
binary endpoint, which only serves **public** skills (``user_id == 0``). Hence
this registrar publishes the skill under ``user_id=0`` / ``namespace=default``
so any user's bid drafting can reach it.

Idempotent: an existing active Skill with the same (namespace, name, user_id)
is left as-is and not re-created.
"""

import io
import zipfile
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.kind import Kind
from app.services.adapters.skill_kinds import skill_kinds_service

BID_SECTION_WRITER_NAME = "bid-section-writer"
# Vendored source (frozen upstream): backend/app/services/bid/vendor/skills/...
_VENDOR_ROOT = Path(__file__).parent / "vendor" / "skills" / BID_SECTION_WRITER_NAME


def _zip_skill_folder(folder: Path) -> bytes:
    """Pack ``<folder>/`` into a ZIP whose top-level dir matches its name.

    ``SkillValidator.validate_zip`` requires the entry layout to be
    ``<skill-folder-name>/SKILL.md`` and the ZIP's file name to match that
    folder; we satisfy both by zipping the folder under its own name.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(folder.rglob("*")):
            if path.is_dir():
                continue
            if "__pycache__" in path.parts:
                continue
            arcname = str(path.relative_to(folder.parent))
            z.write(path, arcname)
    return buf.getvalue()


def ensure_bid_skill_registered(db: Session) -> str:
    """Ensure the bid-section-writer Skill CRD exists (public), return its name.

    Reuses the platform ``skill_kinds_service.create_skill`` for ZIP validation,
    sanitization, Kind + SkillBinary persistence and commit. No-op when an
    active Skill already exists for the (default, name, user_id=0) triple.
    """
    existing = (
        db.query(Kind)
        .filter(
            Kind.kind == "Skill",
            Kind.name == BID_SECTION_WRITER_NAME,
            Kind.namespace == "default",
            Kind.user_id == 0,
            Kind.is_active.is_(True),
        )
        .first()
    )
    if existing is not None:
        return BID_SECTION_WRITER_NAME

    zip_bytes = _zip_skill_folder(_VENDOR_ROOT)
    skill_kinds_service.create_skill(
        db,
        name=BID_SECTION_WRITER_NAME,
        namespace="default",
        file_content=zip_bytes,
        file_name=f"{BID_SECTION_WRITER_NAME}.zip",
        user_id=0,  # public: reachable by executor skill_deployer
        add_to_user_default=False,  # system skill, not bound to any user
    )
    return BID_SECTION_WRITER_NAME
