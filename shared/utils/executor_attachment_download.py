# SPDX-FileCopyrightText: 2025 WeCode, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Helpers for downloading attachments via the executor-download endpoint.

The executor-download endpoint returns either:
- HTTP 200 with file bytes (MySQL storage or encrypted S3 attachments)
- HTTP 302 with a presigned URL to internal object storage (plain S3/MinIO)

Callers must not follow redirects automatically on the first request so they
can fetch the presigned URL from the internal network.
"""

from __future__ import annotations

import logging
from typing import BinaryIO, Dict, Optional

import httpx
import requests

from shared.utils.http_client import traced_async_client

logger = logging.getLogger(__name__)


def resolve_executor_download_url(attachment_url: str, api_base_url: str) -> str:
    """Resolve a relative or absolute attachment URL to executor-download.

    User-facing download URLs (/download) are rewritten to /executor-download
    so callers receive internal presigned URLs instead of public ones.
    """
    api_base_url = api_base_url.rstrip("/")

    if attachment_url.startswith("http://") or attachment_url.startswith("https://"):
        resolved = attachment_url
    else:
        path = attachment_url if attachment_url.startswith("/") else f"/{attachment_url}"
        resolved = f"{api_base_url}{path}"

    if "/executor-download" in resolved:
        return resolved

    if resolved.rstrip("/").endswith("/download"):
        return f"{resolved.rstrip('/')[:-len('/download')]}/executor-download"

    return resolved


def _open_executor_attachment_stream(
    response: requests.Response,
    *,
    url: str,
    headers: Dict[str, str],
    timeout: int,
) -> requests.Response:
    """Return a streaming response after handling executor-download redirects."""
    if response.status_code == 302:
        location = response.headers.get("Location")
        response.close()
        if not location:
            raise requests.HTTPError(
                f"Executor download redirect missing Location header: {url}"
            )
        logger.info("Following executor-download presigned URL redirect")
        redirect_response = requests.get(
            location,
            timeout=timeout,
            stream=True,
        )
        redirect_response.raise_for_status()
        return redirect_response

    if response.status_code != 200:
        response.close()
        raise requests.HTTPError(
            f"Executor download failed with HTTP {response.status_code}: {url}"
        )

    return response


def stream_executor_attachment_to_file(
    url: str,
    destination: BinaryIO,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 300,
    chunk_size: int = 8192,
) -> int:
    """Stream an executor-download attachment into a writable file object.

    Returns:
        Total number of bytes written.
    """
    request_headers = dict(headers or {})
    initial_response = requests.get(
        url,
        headers=request_headers,
        timeout=timeout,
        stream=True,
        allow_redirects=False,
    )

    try:
        response = _open_executor_attachment_stream(
            initial_response,
            url=url,
            headers=request_headers,
            timeout=timeout,
        )
        total_bytes = 0
        for chunk in response.iter_content(chunk_size=chunk_size):
            if chunk:
                destination.write(chunk)
                total_bytes += len(chunk)
        return total_bytes
    finally:
        initial_response.close()


async def download_executor_attachment_bytes(
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 300,
    max_bytes: Optional[int] = None,
) -> bytes:
    """Download an executor-download attachment into memory."""
    request_headers = dict(headers or {})

    async with traced_async_client(timeout=timeout) as client:
        response = await client.get(
            url,
            headers=request_headers,
            follow_redirects=False,
        )

        if response.status_code == 302:
            location = response.headers.get("Location")
            if not location:
                raise httpx.HTTPError(
                    f"Executor download redirect missing Location header: {url}"
                )
            logger.info("Following executor-download presigned URL redirect")
            response = await client.get(location, follow_redirects=True)

        if response.status_code != 200:
            raise httpx.HTTPError(
                f"Executor download failed with HTTP {response.status_code}: {url}"
            )

        content = response.content
        if max_bytes is not None and len(content) > max_bytes:
            raise ValueError(
                f"Attachment too large: {len(content)} bytes (max: {max_bytes} bytes)"
            )
        return content
