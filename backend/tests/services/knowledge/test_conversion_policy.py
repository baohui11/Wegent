# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for knowledge document conversion policy."""

from unittest.mock import MagicMock

from app.services.knowledge.conversion_policy import (
    document_requests_enhanced_pdf_parsing,
    should_run_document_conversion,
)


def _settings(*, enabled: bool = True, file_types: str = "pdf,pptx"):
    settings = MagicMock()
    settings.needs_conversion.side_effect = lambda ext: (
        enabled and ext.lstrip(".").lower() in {"pdf", "pptx"}
    )
    return settings


class TestDocumentRequestsEnhancedPdfParsing:
    def test_returns_false_when_source_config_missing(self):
        assert document_requests_enhanced_pdf_parsing(None) is False
        assert document_requests_enhanced_pdf_parsing({}) is False

    def test_returns_true_when_flag_set(self):
        assert document_requests_enhanced_pdf_parsing({"enhanced_pdf_parsing": True})


class TestShouldRunDocumentConversion:
    def test_pdf_requires_opt_in(self):
        settings = _settings()
        assert (
            should_run_document_conversion(
                file_extension="pdf",
                source_config={},
                settings=settings,
            )
            is False
        )
        assert (
            should_run_document_conversion(
                file_extension="pdf",
                source_config={"enhanced_pdf_parsing": True},
                settings=settings,
            )
            is True
        )

    def test_non_pdf_uses_global_file_types(self):
        settings = _settings()
        assert (
            should_run_document_conversion(
                file_extension="pptx",
                source_config={},
                settings=settings,
            )
            is True
        )

    def test_respects_global_disabled_conversion(self):
        settings = _settings(enabled=False)
        assert (
            should_run_document_conversion(
                file_extension="pdf",
                source_config={"enhanced_pdf_parsing": True},
                settings=settings,
            )
            is False
        )
