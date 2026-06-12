#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Workspace file helpers shared by archive and incremental S3 sync.

This module centralises the exclusion rules and the file-walking logic so the
tar-based archive endpoint and the incremental ``workspace sync`` endpoints
behave consistently (same ignore patterns, same notion of "interesting"
files).

The sync flow keeps the executor stateless with respect to object-storage
credentials: the backend mints presigned PUT URLs and this module only uploads
the bytes that the backend asked for.
"""

import hashlib
from pathlib import Path
from typing import Iterator, List, Optional, TypedDict

import httpx

from shared.logger import setup_logger

logger = setup_logger("envd_workspace_files")

# Exclusion patterns shared by workspace archive and workspace sync.
# Directory names match on any path part; ``*`` prefixed patterns match suffix.
WORKSPACE_EXCLUDE_PATTERNS = [
    "node_modules",
    "__pycache__",
    "*.pyc",
    ".venv",
    "venv",
    "target",
    "build",
    "dist",
    "*.log",
    ".next",
    ".nuxt",
    ".npm",
    ".pnpm-store",
    ".yarn",
    "vendor",
    ".cache",
]

# Read files in chunks when hashing to keep memory bounded for large files.
_HASH_CHUNK_SIZE = 1024 * 1024


class ManifestEntry(TypedDict):
    """A single workspace file descriptor used for diffing against S3."""

    path: str  # POSIX relative path from the sync root
    size: int
    mtime: float
    sha256: str


def should_exclude_workspace_path(name: str) -> bool:
    """Check if a file or directory should be excluded from workspace ops."""
    parts = Path(name).parts
    for pattern in WORKSPACE_EXCLUDE_PATTERNS:
        if pattern.startswith("*"):
            if name.endswith(pattern[1:]):
                return True
        elif pattern in parts:
            return True
    return False


def iter_workspace_files(root: Path) -> Iterator[Path]:
    """Yield non-excluded regular files under ``root`` recursively."""
    if not root.exists() or not root.is_dir():
        return

    for current_dir, dirnames, filenames in _walk(root):
        # Prune excluded directories in-place so os.walk does not descend.
        dirnames[:] = [
            d
            for d in dirnames
            if not should_exclude_workspace_path(
                str((current_dir / d).relative_to(root))
            )
        ]
        for filename in filenames:
            file_path = current_dir / filename
            rel = str(file_path.relative_to(root))
            if should_exclude_workspace_path(rel):
                continue
            if file_path.is_symlink() or not file_path.is_file():
                continue
            yield file_path


def _walk(root: Path):
    """Wrapper around os.walk yielding Path objects (kept small for testing)."""
    import os

    for current_dir, dirnames, filenames in os.walk(root):
        yield Path(current_dir), dirnames, filenames


def _hash_file(file_path: Path) -> str:
    """Return the hex SHA-256 of a file, streamed to bound memory usage."""
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_HASH_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_workspace_manifest(root: Path) -> List[ManifestEntry]:
    """Build a manifest of all syncable files under ``root``.

    Returns POSIX relative paths so the backend can map them onto S3 object
    keys regardless of the operating system the executor runs on.
    """
    entries: List[ManifestEntry] = []
    for file_path in iter_workspace_files(root):
        try:
            stat = file_path.stat()
            rel_path = file_path.relative_to(root).as_posix()
            entries.append(
                ManifestEntry(
                    path=rel_path,
                    size=stat.st_size,
                    mtime=stat.st_mtime,
                    sha256=_hash_file(file_path),
                )
            )
        except OSError as exc:
            logger.warning("[workspace_sync] skip unreadable file %s: %s", file_path, exc)
    return entries


async def upload_file_to_url(file_path: Path, upload_url: str) -> None:
    """Upload a single file to object storage using a presigned PUT URL."""
    with open(file_path, "rb") as handle:
        content = handle.read()
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.put(
            upload_url,
            content=content,
            headers={"Content-Type": "application/octet-stream"},
        )
        response.raise_for_status()


async def sync_files_to_urls(
    root: Path,
    uploads: List[dict],
) -> tuple[List[str], List[str]]:
    """Upload the requested files to their presigned URLs.

    Args:
        root: Sync root directory.
        uploads: List of ``{"path": relative_path, "url": presigned_put_url}``.

    Returns:
        Tuple of (uploaded_paths, failed_paths).
    """
    uploaded: List[str] = []
    failed: List[str] = []
    for item in uploads:
        rel_path: Optional[str] = item.get("path")
        url: Optional[str] = item.get("url")
        if not rel_path or not url:
            continue
        file_path = root / rel_path
        if not file_path.is_file():
            logger.warning("[workspace_sync] requested file missing: %s", file_path)
            failed.append(rel_path)
            continue
        try:
            await upload_file_to_url(file_path, url)
            uploaded.append(rel_path)
        except Exception as exc:
            logger.warning("[workspace_sync] upload failed path=%s: %s", rel_path, exc)
            failed.append(rel_path)
    return uploaded, failed
