# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Baidu PaddleOCR cloud API client for document-to-Markdown conversion.

Responsibilities:
- Submit document conversion jobs (multipart upload)
- Poll job status until completion
- Download JSONL result payload

API reference: https://paddleocr.aistudio-app.com/
"""

import asyncio
import json
import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

DEFAULT_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"

# Official PaddleOCR cloud API input formats.
PADDLEOCR_SUPPORTED_EXTENSIONS = frozenset(
    {
        "pdf",
        "jpeg",
        "jpg",
        "png",
        "tiff",
        "tif",
        "bmp",
    }
)

PADDLEOCR_MIME_TYPES = {
    "pdf": "application/pdf",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "tiff": "image/tiff",
    "tif": "image/tiff",
    "bmp": "image/bmp",
}


def is_paddleocr_supported_extension(ext: str) -> bool:
    """Check if file extension is supported by PaddleOCR cloud API."""
    return ext.lstrip(".").lower() in PADDLEOCR_SUPPORTED_EXTENSIONS


@dataclass(frozen=True)
class PaddleOCRConfig:
    """Configuration for PaddleOCR cloud API."""

    token: str
    job_url: str = DEFAULT_JOB_URL
    model: str = "PaddleOCR-VL-1.6"
    use_doc_orientation_classify: bool = False
    use_doc_unwarping: bool = False
    use_chart_recognition: bool = False
    poll_interval_seconds: int = 5
    max_wait_seconds: int = 1800


def _build_optional_payload(config: PaddleOCRConfig) -> dict:
    return {
        "useDocOrientationClassify": config.use_doc_orientation_classify,
        "useDocUnwarping": config.use_doc_unwarping,
        "useChartRecognition": config.use_chart_recognition,
    }


async def submit_and_wait(
    binary_data: bytes,
    file_extension: str,
    config: PaddleOCRConfig,
) -> str:
    """
    Submit document to PaddleOCR and wait for JSONL result text.

    Args:
        binary_data: Document binary content
        file_extension: Extension with or without dot (e.g., "pdf")
        config: PaddleOCR API configuration

    Returns:
        JSONL result text downloaded from resultUrl.jsonUrl

    Raises:
        RuntimeError: If submission, polling, or download fails
    """
    if not config.token:
        raise RuntimeError("PaddleOCR token is not configured")

    ext = file_extension.lstrip(".").lower()
    if not is_paddleocr_supported_extension(ext):
        raise RuntimeError(
            f"PaddleOCR does not support '{ext}'. "
            f"Supported: {', '.join(sorted(PADDLEOCR_SUPPORTED_EXTENSIONS))}"
        )

    mime_type = PADDLEOCR_MIME_TYPES[ext]
    filename = f"document.{ext}"
    job_url = config.job_url.rstrip("/")

    async with httpx.AsyncClient() as client:
        job_id = await _submit_job(client, job_url, filename, binary_data, mime_type, config)
        json_url = await _poll_until_done(client, job_url, job_id, config)
        return await _download_jsonl(client, json_url)


async def _submit_job(
    client: httpx.AsyncClient,
    job_url: str,
    filename: str,
    binary_data: bytes,
    mime_type: str,
    config: PaddleOCRConfig,
) -> str:
    """Submit a local file conversion job."""
    headers = {"Authorization": f"bearer {config.token}"}
    data = {
        "model": config.model,
        "optionalPayload": json.dumps(_build_optional_payload(config)),
    }
    files = {"file": (filename, binary_data, mime_type)}

    logger.info("[PaddleOCR] Submitting job to %s", job_url)
    response = await client.post(job_url, headers=headers, data=data, files=files, timeout=120.0)
    response.raise_for_status()

    payload = response.json()
    try:
        job_id = payload["data"]["jobId"]
    except (KeyError, TypeError) as exc:
        raise RuntimeError(f"PaddleOCR submit response missing jobId: {payload}") from exc

    logger.info("[PaddleOCR] Job submitted: %s", job_id)
    return job_id


async def _poll_until_done(
    client: httpx.AsyncClient,
    job_url: str,
    job_id: str,
    config: PaddleOCRConfig,
) -> str:
    """Poll PaddleOCR job status until completion and return JSONL URL."""
    start_time = asyncio.get_running_loop().time()
    consecutive_errors = 0
    max_consecutive_errors = 5

    while True:
        elapsed = asyncio.get_running_loop().time() - start_time
        if elapsed > config.max_wait_seconds:
            raise RuntimeError(
                f"PaddleOCR job timeout after {config.max_wait_seconds}s: {job_id}"
            )

        try:
            status_url = f"{job_url}/{job_id}"
            status_resp = await client.get(status_url, headers=_auth_headers(config), timeout=30.0)
            status_resp.raise_for_status()

            data = status_resp.json().get("data", {})
            state = str(data.get("state", "")).lower()

            if state == "done":
                try:
                    json_url = data["resultUrl"]["jsonUrl"]
                except (KeyError, TypeError) as exc:
                    raise RuntimeError(
                        f"PaddleOCR job {job_id} done but jsonUrl missing: {data}"
                    ) from exc
                logger.info("[PaddleOCR] Job completed: %s", job_id)
                return json_url

            if state == "failed":
                error_msg = data.get("errorMsg", "unknown error")
                raise RuntimeError(f"PaddleOCR job failed: {job_id}, reason={error_msg}")

            consecutive_errors = 0
            if state in {"pending", "running", ""}:
                progress = data.get("extractProgress") or {}
                logger.debug(
                    "[PaddleOCR] Job %s state=%s progress=%s/%s",
                    job_id,
                    state or "unknown",
                    progress.get("extractedPages"),
                    progress.get("totalPages"),
                )
            else:
                logger.debug("[PaddleOCR] Job %s state=%s, waiting...", job_id, state)

            await asyncio.sleep(config.poll_interval_seconds)
        except RuntimeError:
            raise
        except Exception as exc:
            consecutive_errors += 1
            if consecutive_errors >= max_consecutive_errors:
                raise RuntimeError(
                    f"PaddleOCR consecutive errors ({consecutive_errors}) "
                    f"exceeded threshold ({max_consecutive_errors})"
                ) from exc
            logger.warning(
                "[PaddleOCR] Status check error (%s/%s): %s",
                consecutive_errors,
                max_consecutive_errors,
                exc,
            )
            await asyncio.sleep(config.poll_interval_seconds)


async def _download_jsonl(client: httpx.AsyncClient, json_url: str) -> str:
    """Download JSONL result text from PaddleOCR."""
    logger.info("[PaddleOCR] Downloading JSONL result")
    response = await client.get(json_url, timeout=120.0)
    response.raise_for_status()
    return response.text


def _auth_headers(config: PaddleOCRConfig) -> dict[str, str]:
    return {"Authorization": f"bearer {config.token}"}
