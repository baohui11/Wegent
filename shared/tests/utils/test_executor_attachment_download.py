# SPDX-FileCopyrightText: 2025 WeCode, Inc.
#
# SPDX-License-Identifier: Apache-2.0

from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import requests

from shared.utils.executor_attachment_download import (
    download_executor_attachment_bytes,
    resolve_executor_download_url,
    stream_executor_attachment_to_file,
)


class TestResolveExecutorDownloadUrl:
    def test_rewrites_user_download_path(self):
        url = resolve_executor_download_url(
            "/api/attachments/42/download",
            "http://backend:8000",
        )
        assert url == "http://backend:8000/api/attachments/42/executor-download"

    def test_keeps_executor_download_path(self):
        url = resolve_executor_download_url(
            "/api/attachments/42/executor-download",
            "http://backend:8000",
        )
        assert url == "http://backend:8000/api/attachments/42/executor-download"

    def test_preserves_absolute_url(self):
        url = resolve_executor_download_url(
            "http://backend:8000/api/attachments/42/executor-download",
            "http://ignored:8000",
        )
        assert url == "http://backend:8000/api/attachments/42/executor-download"


class TestStreamExecutorAttachmentToFile:
    def test_streams_direct_response(self):
        direct_response = MagicMock()
        direct_response.status_code = 200
        direct_response.headers = {}
        direct_response.iter_content.return_value = [b"hello", b" world"]
        direct_response.close = MagicMock()

        with patch(
            "shared.utils.executor_attachment_download.requests.get",
            return_value=direct_response,
        ) as mock_get:
            buffer = BytesIO()
            total = stream_executor_attachment_to_file(
                "http://backend:8000/api/attachments/1/executor-download",
                buffer,
                headers={"Authorization": "Bearer token"},
            )

        mock_get.assert_called_once()
        assert mock_get.call_args.kwargs["allow_redirects"] is False
        assert total == 11
        assert buffer.getvalue() == b"hello world"

    def test_follows_presigned_redirect(self):
        redirect_response = MagicMock()
        redirect_response.status_code = 302
        redirect_response.headers = {"Location": "http://minio:9000/bucket/key"}
        redirect_response.close = MagicMock()

        presigned_response = MagicMock()
        presigned_response.status_code = 200
        presigned_response.iter_content.return_value = [b"payload"]
        presigned_response.raise_for_status = MagicMock()

        with patch(
            "shared.utils.executor_attachment_download.requests.get",
            side_effect=[redirect_response, presigned_response],
        ) as mock_get:
            buffer = BytesIO()
            total = stream_executor_attachment_to_file(
                "http://backend:8000/api/attachments/1/executor-download",
                buffer,
            )

        assert mock_get.call_count == 2
        assert mock_get.call_args_list[1].args[0] == "http://minio:9000/bucket/key"
        assert total == 7
        assert buffer.getvalue() == b"payload"


@pytest.mark.asyncio
async def test_download_executor_attachment_bytes_follows_redirect():
    redirect_response = httpx.Response(
        302,
        headers={"Location": "http://minio:9000/bucket/key"},
        request=httpx.Request("GET", "http://backend/download"),
    )
    file_response = httpx.Response(
        200,
        content=b"file-bytes",
        request=httpx.Request("GET", "http://minio:9000/bucket/key"),
    )

    mock_client = MagicMock()
    mock_client.get = AsyncMock(
        side_effect=[redirect_response, file_response],
    )
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch(
        "shared.utils.executor_attachment_download.traced_async_client",
        return_value=mock_client,
    ):
        content = await download_executor_attachment_bytes(
            "http://backend:8000/api/attachments/1/executor-download",
            headers={"Authorization": "Bearer token"},
        )

    assert content == b"file-bytes"
    assert mock_client.get.call_count == 2
