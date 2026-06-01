# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Extract Markdown and localize images from PaddleOCR JSONL results.

Handles:
- Parsing JSONL lines with layoutParsingResults
- Concatenating page markdown
- Downloading remote images and uploading to S3
- Replacing image references in Markdown with S3 URLs
"""

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from knowledge_engine.conversion.s3_uploader import S3Uploader
from knowledge_engine.conversion.zip_extractor import CONTENT_TYPE_MAP

logger = logging.getLogger(__name__)

MD_IMG_PATTERN = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
HTML_IMG_PATTERN = re.compile(r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>', re.IGNORECASE)


@dataclass
class ExtractionResult:
    """Result of JSONL extraction."""

    markdown_bytes: bytes
    uploaded_images: List[Tuple[str, str]] = field(default_factory=list)


def extract_markdown_from_jsonl(
    jsonl_text: str,
    s3_uploader: S3Uploader,
    s3_base_path: str,
) -> ExtractionResult:
    """
    Extract markdown from PaddleOCR JSONL and localize images to S3.

    Args:
        jsonl_text: Raw JSONL response text
        s3_uploader: S3 uploader (must be enabled)
        s3_base_path: Base path for S3 object keys

    Returns:
        ExtractionResult with markdown bytes and uploaded image list

    Raises:
        RuntimeError: If JSONL is invalid or S3 upload is disabled
    """
    if not s3_uploader.enabled:
        raise RuntimeError(
            "PaddleOCR conversion requires WORKER_CONVERSION_S3_ENABLED=true "
            "to localize images"
        )

    page_sections: List[str] = []
    uploaded_images: List[Tuple[str, str]] = []
    url_mapping: Dict[str, str] = {}

    lines = [line.strip() for line in jsonl_text.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("PaddleOCR JSONL result is empty")

    page_index = 0
    for line_num, line in enumerate(lines, start=1):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Invalid PaddleOCR JSONL at line {line_num}: {exc}"
            ) from exc

        result = payload.get("result") or {}
        layout_results = result.get("layoutParsingResults") or []
        if not layout_results:
            logger.warning(
                "[PaddleOCR] JSONL line %s has no layoutParsingResults", line_num
            )
            continue

        for layout in layout_results:
            markdown = layout.get("markdown") or {}
            text = str(markdown.get("text") or "").strip()
            if not text:
                continue

            page_images = _collect_page_image_urls(markdown, layout.get("outputImages"))
            page_index += 1
            localized_text = _localize_page_images(
                text=text,
                page_images=page_images,
                s3_uploader=s3_uploader,
                s3_base_path=s3_base_path,
                page_index=page_index,
                url_mapping=url_mapping,
                uploaded_images=uploaded_images,
            )
            page_sections.append(localized_text)

    if not page_sections:
        raise RuntimeError("No markdown content found in PaddleOCR JSONL result")

    combined = "\n\n---\n\n".join(page_sections)
    logger.info(
        "[PaddleOCR] Extracted %s page section(s), uploaded %s image(s)",
        len(page_sections),
        len(uploaded_images),
    )
    return ExtractionResult(
        markdown_bytes=combined.encode("utf-8"),
        uploaded_images=uploaded_images,
    )


def _collect_page_image_urls(
    markdown: dict,
    output_images: Optional[dict],
) -> Dict[str, str]:
    """Collect relative path / filename -> remote URL mappings for one page."""
    images: Dict[str, str] = {}

    markdown_images = markdown.get("images") or {}
    if isinstance(markdown_images, dict):
        for path, url in markdown_images.items():
            if isinstance(url, str) and url.strip():
                images[str(path)] = url.strip()

    if isinstance(output_images, dict):
        for name, url in output_images.items():
            if isinstance(url, str) and url.strip():
                images[str(name)] = url.strip()

    return images


def _localize_page_images(
    *,
    text: str,
    page_images: Dict[str, str],
    s3_uploader: S3Uploader,
    s3_base_path: str,
    page_index: int,
    url_mapping: Dict[str, str],
    uploaded_images: List[Tuple[str, str]],
) -> str:
    """Download page images, upload to S3, and replace markdown references."""
    for ref, remote_url in page_images.items():
        _ensure_image_uploaded(
            ref=ref,
            remote_url=remote_url,
            s3_uploader=s3_uploader,
            s3_base_path=s3_base_path,
            page_index=page_index,
            url_mapping=url_mapping,
            uploaded_images=uploaded_images,
        )

    def replace_md_ref(match: re.Match[str]) -> str:
        alt_text = match.group(1)
        ref = match.group(2).strip()
        if ref.startswith(("http://", "https://")):
            return match.group(0)
        normalized = ref.lstrip("./").lstrip("/")
        public_url = _resolve_public_url(ref, normalized, url_mapping)
        if public_url:
            return f"![{alt_text}]({public_url})"
        return match.group(0)

    text = MD_IMG_PATTERN.sub(replace_md_ref, text)

    def replace_html_ref(match: re.Match[str]) -> str:
        ref = match.group(1).strip()
        if ref.startswith(("http://", "https://")):
            return match.group(0)
        normalized = ref.lstrip("./").lstrip("/")
        public_url = _resolve_public_url(ref, normalized, url_mapping)
        if public_url:
            return match.group(0).replace(ref, public_url)
        return match.group(0)

    return HTML_IMG_PATTERN.sub(replace_html_ref, text)


def _resolve_public_url(
    ref: str,
    normalized: str,
    url_mapping: Dict[str, str],
) -> Optional[str]:
    for candidate in (ref, normalized, os.path.basename(normalized)):
        if candidate in url_mapping:
            return url_mapping[candidate]
    return None


def _ensure_image_uploaded(
    *,
    ref: str,
    remote_url: str,
    s3_uploader: S3Uploader,
    s3_base_path: str,
    page_index: int,
    url_mapping: Dict[str, str],
    uploaded_images: List[Tuple[str, str]],
) -> None:
    """Upload one remote image if not already cached in url_mapping."""
    cache_keys = {
        ref,
        ref.lstrip("./").lstrip("/"),
        os.path.basename(ref),
        remote_url,
    }
    if any(key in url_mapping for key in cache_keys):
        return

    try:
        image_data = _download_image(remote_url)
    except Exception as exc:
        logger.warning("[PaddleOCR] Failed to download image %s: %s", remote_url, exc)
        return

    ext = _guess_extension(ref, remote_url)
    content_type = CONTENT_TYPE_MAP.get(ext, "image/jpeg")
    safe_ref = ref.lstrip("./").lstrip("/").replace("\\", "/")
    object_name = f"{s3_base_path}/page_{page_index}/{safe_ref}"

    public_url = s3_uploader.upload_image(image_data, object_name, content_type)
    if not public_url:
        logger.warning("[PaddleOCR] Failed to upload image to S3: %s", object_name)
        return

    uploaded_images.append((object_name, public_url))
    for key in cache_keys:
        url_mapping[key] = public_url


def _download_image(url: str) -> bytes:
    """Download image bytes from a remote URL."""
    with httpx.Client(timeout=60.0) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.content


def _guess_extension(ref: str, remote_url: str) -> str:
    for candidate in (ref, remote_url):
        path = urlparse(candidate).path if "://" in candidate else candidate
        ext = os.path.splitext(path)[1].lower()
        if ext:
            return ext
    return ".jpg"
