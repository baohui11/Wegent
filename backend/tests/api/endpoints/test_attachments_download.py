# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for user attachment download presign redirect behaviour."""

from unittest.mock import MagicMock, patch

from fastapi.responses import RedirectResponse

from app.api.endpoints.adapter import attachments as attachments_module
from app.models.subtask_context import ContextStatus, ContextType, SubtaskContext


def _attachment_context(*, encrypted: bool = False) -> SubtaskContext:
    return SubtaskContext(
        id=42,
        subtask_id=0,
        user_id=1,
        context_type=ContextType.ATTACHMENT.value,
        name="report.pdf",
        status=ContextStatus.READY.value,
        type_data={
            "original_filename": "report.pdf",
            "file_extension": ".pdf",
            "file_size": 128,
            "mime_type": "application/pdf",
            "storage_backend": "s3",
            "storage_key": "attachments/key-42",
            "is_encrypted": encrypted,
        },
    )


def test_user_download_redirects_to_public_presign_when_s3_ready() -> None:
    context = _attachment_context()
    backend = MagicMock()
    backend.backend_type = "s3"
    backend.get_url.return_value = "http://localhost:9000/attachments/key-42?sig=abc"

    with (
        patch.object(
            attachments_module,
            "is_external_storage_configured",
            return_value=True,
        ),
        patch.object(
            attachments_module,
            "get_storage_backend",
            return_value=backend,
        ),
    ):
        response = attachments_module._try_redirect_user_download_to_presigned_url(
            MagicMock(),
            attachment_id=42,
            context=context,
        )

    assert isinstance(response, RedirectResponse)
    assert response.status_code == 302
    assert (
        response.headers["location"]
        == "http://localhost:9000/attachments/key-42?sig=abc"
    )
    backend.get_url.assert_called_once_with(
        "attachments/key-42",
        expires=attachments_module._USER_DOWNLOAD_URL_TTL_SECONDS,
        public=True,
    )


def test_user_download_presign_skipped_for_encrypted_attachments() -> None:
    context = _attachment_context(encrypted=True)

    with patch.object(
        attachments_module,
        "is_external_storage_configured",
        return_value=True,
    ):
        response = attachments_module._try_redirect_user_download_to_presigned_url(
            MagicMock(),
            attachment_id=42,
            context=context,
        )

    assert response is None


def test_user_download_presign_skipped_when_storage_unconfigured() -> None:
    context = _attachment_context()

    with patch.object(
        attachments_module,
        "is_external_storage_configured",
        return_value=False,
    ):
        response = attachments_module._try_redirect_user_download_to_presigned_url(
            MagicMock(),
            attachment_id=42,
            context=context,
        )

    assert response is None
