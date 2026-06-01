# SPDX-FileCopyrightText: 2025 WeCode, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Sandbox attachment download tool.

This module provides the SandboxDownloadAttachmentTool class that downloads
files from Wegent Backend to the sandbox environment via the executor-download
API, including S3 presigned URL redirects.
"""

import json
import logging
import os
import time
from typing import Optional

from langchain_core.callbacks import CallbackManagerForToolRun
from pydantic import BaseModel, Field

from shared.utils.executor_attachment_download import (
    download_executor_attachment_bytes,
    resolve_executor_download_url,
)

logger = logging.getLogger(__name__)

# Default API base URL for attachment downloads
DEFAULT_API_BASE_URL = "http://backend:8000"

# Maximum download size (100 MB, aligned with upload_attachment)
MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024


class SandboxDownloadAttachmentInput(BaseModel):
    """Input schema for download_attachment tool."""

    attachment_url: str = Field(
        ...,
        description=(
            "Wegent attachment URL (e.g., /api/attachments/123/download or "
            "/api/attachments/123/executor-download)"
        ),
    )
    save_path: str = Field(
        ...,
        description="Path to save the file in sandbox",
    )
    timeout_seconds: Optional[int] = Field(
        default=300,
        description="Download timeout in seconds (default: 300)",
    )


# Import base class here - use try/except to handle both direct and dynamic loading
try:
    # Try relative import (for direct usage)
    from ._base import BaseSandboxTool
except ImportError:
    # Try absolute import (for dynamic loading as skill_pkg_sandbox)
    import sys

    # Get the package name dynamically
    package_name = __name__.rsplit(".", 1)[0]  # e.g., 'skill_pkg_sandbox'
    _base_module = sys.modules.get(f"{package_name}._base")
    if _base_module:
        BaseSandboxTool = _base_module.BaseSandboxTool
    else:
        raise ImportError(f"Cannot import _base from {package_name}")


class SandboxDownloadAttachmentTool(BaseSandboxTool):
    """Tool for downloading files from Wegent Backend to E2B sandbox.

    This tool downloads files from Wegent's attachment storage to the
    sandbox environment via the /api/attachments/{id}/executor-download endpoint.
    """

    name: str = "download_attachment"
    display_name: str = "下载文件"
    description: str = """Download a file from Wegent attachment URL to sandbox.

Use this tool to download attachments from Wegent to the sandbox environment
for processing or editing. User-facing /download URLs are accepted and are
automatically resolved to the executor-download endpoint.

Parameters:
- attachment_url (required): Wegent attachment URL (e.g., /api/attachments/123/download)
- save_path (required): Path to save the file in sandbox
- timeout_seconds (optional): Download timeout in seconds (default: 300)

Returns:
- success: Whether the download succeeded
- file_path: Full path to the downloaded file in sandbox
- file_size: Size of the downloaded file in bytes
- message: Status message

Example:
{
  "attachment_url": "/api/attachments/123/download",
  "save_path": "/home/user/downloads/report.pdf"
}
"""

    args_schema: type[BaseModel] = SandboxDownloadAttachmentInput

    # Configuration
    default_download_timeout: int = 300

    # Auth token - will be injected from context/config
    auth_token: str = ""
    api_base_url: str = ""

    def _run(
        self,
        attachment_url: str,
        save_path: str,
        timeout_seconds: Optional[int] = None,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        """Synchronous run - not implemented."""
        raise NotImplementedError(
            "SandboxDownloadAttachmentTool only supports async execution"
        )

    async def _arun(
        self,
        attachment_url: str,
        save_path: str,
        timeout_seconds: Optional[int] = None,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        """Download file from Wegent Backend to sandbox.

        Args:
            attachment_url: Wegent attachment URL (e.g., /api/attachments/123/download)
            save_path: Path to save the file in sandbox
            timeout_seconds: Download timeout in seconds
            run_manager: Callback manager

        Returns:
            JSON string with download result
        """
        start_time = time.time()
        effective_timeout = timeout_seconds or self.default_download_timeout

        logger.info(
            f"[SandboxDownloadAttachmentTool] Downloading: {attachment_url} -> {save_path}, "
            f"timeout={effective_timeout}s"
        )

        # Emit status update via WebSocket if available
        if self.ws_emitter:
            try:
                await self.ws_emitter.emit_tool_call(
                    task_id=self.task_id,
                    tool_name=self.name,
                    tool_input={
                        "attachment_url": attachment_url,
                        "save_path": save_path,
                    },
                    status="running",
                )
            except Exception as e:
                logger.warning(
                    f"[SandboxDownloadAttachmentTool] Failed to emit tool status: {e}"
                )

        try:
            # Get sandbox manager from base class
            sandbox_manager = self._get_sandbox_manager()

            # Get or create sandbox
            logger.info(
                f"[SandboxDownloadAttachmentTool] Getting or creating sandbox..."
            )
            sandbox, error = await sandbox_manager.get_or_create_sandbox(
                shell_type=self.default_shell_type,
                workspace_ref=None,
            )

            if error:
                logger.error(
                    f"[SandboxDownloadAttachmentTool] Failed to create sandbox: {error}"
                )
                result = self._format_error(
                    error_message=f"Failed to create sandbox: {error}",
                    file_path="",
                    file_size=0,
                )
                await self._emit_tool_status("failed", error)
                return result

            # Normalize save path
            if not save_path.startswith("/"):
                save_path = f"/home/user/{save_path}"

            # Create parent directories if needed
            parent_dir = os.path.dirname(save_path)
            if parent_dir and parent_dir != "/":
                try:
                    await sandbox.files.make_dir(parent_dir)
                    logger.info(
                        f"[SandboxDownloadAttachmentTool] Created directory: {parent_dir}"
                    )
                except Exception as e:
                    # Directory might already exist, that's okay
                    logger.debug(
                        f"[SandboxDownloadAttachmentTool] Directory creation skipped: {e}"
                    )

            # Get API base URL and auth token
            api_base_url = self.api_base_url or os.getenv(
                "BACKEND_API_URL", DEFAULT_API_BASE_URL
            )
            api_base_url = api_base_url.rstrip("/")

            download_url = resolve_executor_download_url(attachment_url, api_base_url)

            auth_token = self.auth_token
            if not auth_token:
                error_msg = "No authentication token available for download"
                result = self._format_error(
                    error_message=error_msg,
                    file_path="",
                    file_size=0,
                )
                await self._emit_tool_status("failed", error_msg)
                return result

            logger.info(
                "[SandboxDownloadAttachmentTool] Downloading via executor-download: %s",
                download_url,
            )

            try:
                file_bytes = await download_executor_attachment_bytes(
                    download_url,
                    headers={"Authorization": f"Bearer {auth_token}"},
                    timeout=effective_timeout,
                    max_bytes=MAX_DOWNLOAD_SIZE,
                )
            except ValueError as e:
                error_msg = str(e)
                result = self._format_error(
                    error_message=error_msg,
                    file_path=save_path,
                    file_size=0,
                )
                await self._emit_tool_status("failed", error_msg)
                return result
            except Exception as e:
                error_msg = f"Download failed: {e}"
                logger.error(f"[SandboxDownloadAttachmentTool] {error_msg}")
                result = self._format_error(
                    error_message=error_msg,
                    file_path=save_path,
                    file_size=0,
                )
                await self._emit_tool_status("failed", error_msg)
                return result

            await sandbox.files.write(save_path, file_bytes)

            execution_time = time.time() - start_time
            file_size = len(file_bytes)

            try:
                file_info = await sandbox.files.get_info(save_path)
                file_size = file_info.size
            except Exception as e:
                error_msg = f"File was not created after download: {e}"
                logger.error(f"[SandboxDownloadAttachmentTool] {error_msg}")
                result = self._format_error(
                    error_message=error_msg,
                    file_path=save_path,
                    file_size=0,
                )
                await self._emit_tool_status("failed", error_msg)
                return result

            response = {
                "success": True,
                "file_path": save_path,
                "file_size": file_size,
                "message": "File downloaded successfully",
                "execution_time": execution_time,
                "sandbox_id": sandbox.sandbox_id,
            }

            logger.info(
                f"[SandboxDownloadAttachmentTool] Download successful: "
                f"file_path={save_path}, file_size={file_size}"
            )

            # Emit success status
            await self._emit_tool_status(
                "completed",
                f"File downloaded successfully ({file_size} bytes)",
                response,
            )

            return json.dumps(response, ensure_ascii=False, indent=2)

        except ImportError as e:
            logger.error(f"[SandboxDownloadAttachmentTool] E2B SDK import error: {e}")
            error_msg = "E2B SDK not available. Please install e2b-code-interpreter."
            result = self._format_error(
                error_message=error_msg,
                file_path="",
                file_size=0,
            )
            await self._emit_tool_status("failed", error_msg)
            return result
        except Exception as e:
            logger.error(
                f"[SandboxDownloadAttachmentTool] Download failed: {e}", exc_info=True
            )
            error_msg = f"Failed to download file: {e}"
            result = self._format_error(
                error_message=error_msg,
                file_path="",
                file_size=0,
            )
            await self._emit_tool_status("failed", error_msg)
            return result
