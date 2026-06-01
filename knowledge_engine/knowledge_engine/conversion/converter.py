# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Unified document conversion entry point.

Orchestrates conversion via MinerU or PaddleOCR, then localizes images to S3.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import List, Literal, Optional, Tuple

from knowledge_engine.conversion.jsonl_extractor import extract_markdown_from_jsonl
from knowledge_engine.conversion.mineru_client import (
    SUPPORTED_MIME_TYPES,
    MinerUConfig,
    submit_and_wait as mineru_submit_and_wait,
)
from knowledge_engine.conversion.paddleocr_client import (
    PADDLEOCR_SUPPORTED_EXTENSIONS,
    PaddleOCRConfig,
    is_paddleocr_supported_extension,
    submit_and_wait as paddleocr_submit_and_wait,
)
from knowledge_engine.conversion.s3_uploader import S3Config, S3Uploader
from knowledge_engine.conversion.zip_extractor import extract_markdown_from_zip

logger = logging.getLogger(__name__)

ConversionProvider = Literal["mineru", "paddleocr"]


@dataclass(frozen=True)
class ConversionResult:
    """Result of document conversion."""

    markdown_bytes: bytes
    uploaded_images: List[Tuple[str, str]]


def convert_document(
    binary_data: bytes,
    file_extension: str,
    *,
    provider: ConversionProvider = "mineru",
    mineru_config: Optional[MinerUConfig] = None,
    paddleocr_config: Optional[PaddleOCRConfig] = None,
    s3_config: Optional[S3Config] = None,
    s3_base_path: Optional[str] = None,
) -> ConversionResult:
    """
    Convert document to Markdown using the configured OCR provider.

    Args:
        binary_data: Document binary content
        file_extension: File extension (e.g., ".pdf", "docx")
        provider: Conversion backend ("mineru" or "paddleocr")
        mineru_config: MinerU API configuration (required when provider=mineru)
        paddleocr_config: PaddleOCR API configuration (required when provider=paddleocr)
        s3_config: Optional S3 configuration for image upload
        s3_base_path: Base path for S3 object keys

    Returns:
        ConversionResult with markdown and uploaded image list

    Raises:
        RuntimeError: If conversion fails or provider config is missing
    """
    ext = file_extension.lstrip(".").lower()
    normalized_provider = provider.strip().lower()

    if normalized_provider == "paddleocr":
        if not is_paddleocr_supported_extension(ext):
            raise RuntimeError(
                f"PaddleOCR does not support '{ext}'. "
                f"Supported: {', '.join(sorted(PADDLEOCR_SUPPORTED_EXTENSIONS))}. "
                "Use CONVERSION_PROVIDER=mineru for Office formats such as pptx."
            )
    elif ext not in SUPPORTED_MIME_TYPES:
        raise RuntimeError(
            f"Conversion for '{ext}' not supported. "
            f"Supported: {', '.join(SUPPORTED_MIME_TYPES)}"
        )

    if normalized_provider == "paddleocr":
        if paddleocr_config is None:
            raise RuntimeError("paddleocr_config is required when provider=paddleocr")
        if s3_config is None or not s3_config.enabled or not s3_base_path:
            raise RuntimeError(
                "PaddleOCR conversion requires enabled S3 config and s3_base_path"
            )
        jsonl_text = _run_async(
            paddleocr_submit_and_wait(binary_data, ext, paddleocr_config)
        )
        s3_uploader = S3Uploader(s3_config)
        result = extract_markdown_from_jsonl(jsonl_text, s3_uploader, s3_base_path)
        logger.info("[Conversion] PaddleOCR completed for .%s", ext)
        return ConversionResult(
            markdown_bytes=result.markdown_bytes,
            uploaded_images=result.uploaded_images,
        )

    if normalized_provider != "mineru":
        raise RuntimeError(
            f"Unsupported conversion provider: {provider}. "
            "Supported providers: mineru, paddleocr"
        )

    if mineru_config is None:
        raise RuntimeError("mineru_config is required when provider=mineru")

    zip_content = _run_async(mineru_submit_and_wait(binary_data, ext, mineru_config))
    s3_uploader = S3Uploader(s3_config) if s3_config else None
    result = extract_markdown_from_zip(zip_content, s3_uploader, s3_base_path)
    logger.info("[Conversion] MinerU completed for .%s", ext)
    return ConversionResult(
        markdown_bytes=result.markdown_bytes,
        uploaded_images=result.uploaded_images,
    )


def _run_async(coro):
    """Run async OCR client code from sync Celery worker context."""
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        running_loop = None

    if running_loop is not None:
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()
    return asyncio.run(coro)
