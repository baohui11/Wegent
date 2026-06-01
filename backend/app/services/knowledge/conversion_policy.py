# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Knowledge document conversion policy helpers."""

from typing import Any, Mapping, Optional

from app.core.config import Settings


def document_requests_enhanced_pdf_parsing(source_config: Optional[Mapping[str, Any]]) -> bool:
    """Return whether the document was uploaded with PDF enhanced parsing enabled."""
    if not source_config:
        return False
    return bool(source_config.get("enhanced_pdf_parsing"))


def should_run_document_conversion(
    *,
    file_extension: str,
    source_config: Optional[Mapping[str, Any]],
    settings: Settings,
) -> bool:
    """
    Decide whether a document should go through OCR conversion before indexing.

    PDF files require an explicit per-upload opt-in flag. Other configured
    file types keep the global KNOWLEDGE_CONVERSION_FILE_TYPES behavior.
    """
    normalized_extension = file_extension.lstrip(".").lower()
    if not settings.needs_conversion(normalized_extension):
        return False

    if normalized_extension == "pdf":
        return document_requests_enhanced_pdf_parsing(source_config)

    return True
