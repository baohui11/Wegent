# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Document conversion module — PDF/Office to Markdown via MinerU or PaddleOCR."""

from knowledge_engine.conversion.converter import (
    ConversionProvider,
    ConversionResult,
    convert_document,
)
from knowledge_engine.conversion.mineru_client import SUPPORTED_MIME_TYPES, MinerUConfig
from knowledge_engine.conversion.paddleocr_client import PaddleOCRConfig
from knowledge_engine.conversion.s3_uploader import S3Config, S3Uploader

__all__ = [
    "convert_document",
    "ConversionResult",
    "ConversionProvider",
    "MinerUConfig",
    "PaddleOCRConfig",
    "S3Config",
    "S3Uploader",
    "SUPPORTED_MIME_TYPES",
]
