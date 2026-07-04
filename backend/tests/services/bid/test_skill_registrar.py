# SPDX-License-Identifier: Apache-2.0
"""Task 5: register vendored bid-section-writer as a platform Skill (idempotent).

The skill must be PUBLIC (user_id=0) so executor's skill_deployer can fetch its
binary via the internal /skills/{id}/binary endpoint, which only serves
user_id=0 rows. Namespace follows the platform convention ("default").
"""

import pytest

from app.models.kind import Kind
from app.models.skill_binary import SkillBinary
from app.services.bid.skill_registrar import (
    BID_SECTION_WRITER_NAME,
    ensure_bid_skill_registered,
)


def test_ensure_registered_is_idempotent(test_db):
    # First registration creates the Skill Kind + SkillBinary.
    name1 = ensure_bid_skill_registered(test_db)
    name2 = ensure_bid_skill_registered(test_db)
    assert name1 == name2 == BID_SECTION_WRITER_NAME

    rows = (
        test_db.query(Kind)
        .filter(
            Kind.kind == "Skill",
            Kind.name == BID_SECTION_WRITER_NAME,
            Kind.namespace == "default",
            Kind.user_id == 0,
            Kind.is_active.is_(True),
        )
        .all()
    )
    assert len(rows) == 1  # not duplicated


def test_registered_skill_is_public_and_has_binary(test_db):
    name = ensure_bid_skill_registered(test_db)
    assert name == BID_SECTION_WRITER_NAME

    skill = (
        test_db.query(Kind)
        .filter(
            Kind.kind == "Skill",
            Kind.name == BID_SECTION_WRITER_NAME,
            Kind.namespace == "default",
            Kind.user_id == 0,
        )
        .first()
    )
    assert skill is not None
    # public skill (executor reachable) + spec carries the SKILL.md description
    spec = (skill.json or {}).get("spec", {})
    assert spec.get("description")
    assert "ClaudeCode" in (spec.get("bindShells") or [])

    binary = test_db.query(SkillBinary).filter(SkillBinary.kind_id == skill.id).first()
    assert binary is not None
    assert binary.file_size and binary.file_hash
