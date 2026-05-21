# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for attachment object key generation."""

from app.services.attachment.storage_backend import (
    generate_storage_key,
    normalize_storage_extension,
    resolve_attachment_storage_key,
)


def test_generate_storage_key_appends_extension() -> None:
    key = generate_storage_key(38, 1, ".pdf")

    assert key.startswith("attachments/")
    assert key.endswith("_38.pdf")


def test_normalize_storage_extension_rejects_unsafe_values() -> None:
    assert normalize_storage_extension("pdf") == ".pdf"
    assert normalize_storage_extension(".PDF") == ".pdf"
    assert normalize_storage_extension("../evil") == ""


def test_resolve_attachment_storage_key_appends_extension_to_legacy_key() -> None:
    legacy = "attachments/e05170634f0a_20260521145444_1_38"

    key = resolve_attachment_storage_key(38, 1, ".png", legacy)

    assert key == f"{legacy}.png"


def test_resolve_attachment_storage_key_keeps_existing_extension() -> None:
    existing = "attachments/e05170634f0a_20260521145444_1_38.pdf"

    key = resolve_attachment_storage_key(38, 1, ".pdf", existing)

    assert key == existing
