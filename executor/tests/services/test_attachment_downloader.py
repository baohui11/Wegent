# SPDX-FileCopyrightText: 2025 WeCode, Inc.
#
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path
from unittest.mock import patch

from executor.services.attachment_downloader import AttachmentDownloader


class TestAttachmentDownloaderRedirect:
    def test_download_single_uses_executor_download_endpoint(self, tmp_path):
        downloader = AttachmentDownloader(
            workspace=str(tmp_path),
            task_id="123",
            subtask_id="456",
            auth_token="test-token",  # noqa: S106
        )

        attachment = {"id": 7, "original_filename": "report.pdf"}
        Path(downloader.get_attachments_dir()).mkdir(parents=True, exist_ok=True)

        with patch(
            "executor.services.attachment_downloader.stream_executor_attachment_to_file",
        ) as mock_stream:
            mock_stream.side_effect = lambda _url, destination, **kwargs: destination.write(
                b"pdf-content"
            )

            result = downloader._download_single(attachment)

        assert result["local_path"].endswith("report.pdf")
        assert "error" not in result
        mock_stream.assert_called_once()
        assert mock_stream.call_args.args[0].endswith("/executor-download")
