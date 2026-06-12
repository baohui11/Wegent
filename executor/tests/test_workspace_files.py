#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""Tests for envd workspace file sync helpers."""

from pathlib import Path

import pytest

from executor.envd.api.workspace_files import (
    build_workspace_manifest,
    should_exclude_workspace_path,
    sync_files_to_urls,
)


class TestShouldExcludeWorkspacePath:
    def test_excludes_known_directories(self):
        assert should_exclude_workspace_path("node_modules/react/index.js")
        assert should_exclude_workspace_path("src/.venv/lib/foo.py")
        assert should_exclude_workspace_path("build")

    def test_excludes_suffix_patterns(self):
        assert should_exclude_workspace_path("server.log")
        assert should_exclude_workspace_path("module/foo.pyc")

    def test_keeps_normal_files(self):
        assert not should_exclude_workspace_path("src/main.py")
        assert not should_exclude_workspace_path("README.md")


class TestBuildWorkspaceManifest:
    def test_builds_manifest_with_relative_posix_paths(self, tmp_path: Path):
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "main.py").write_text("print('hi')")
        (tmp_path / "README.md").write_text("# title")

        # Excluded content should not appear in the manifest.
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "dep.js").write_text("x")
        (tmp_path / "debug.log").write_text("noise")

        manifest = build_workspace_manifest(tmp_path)
        paths = {entry["path"] for entry in manifest}

        assert paths == {"src/main.py", "README.md"}
        for entry in manifest:
            assert entry["size"] >= 0
            assert isinstance(entry["sha256"], str)
            assert len(entry["sha256"]) == 64

    def test_returns_empty_for_missing_root(self, tmp_path: Path):
        assert build_workspace_manifest(tmp_path / "does-not-exist") == []

    def test_hash_changes_with_content(self, tmp_path: Path):
        target = tmp_path / "a.txt"
        target.write_text("one")
        first = build_workspace_manifest(tmp_path)[0]["sha256"]
        target.write_text("two")
        second = build_workspace_manifest(tmp_path)[0]["sha256"]
        assert first != second


class TestSyncFilesToUrls:
    @pytest.mark.asyncio
    async def test_marks_missing_files_as_failed(self, tmp_path: Path):
        uploaded, failed = await sync_files_to_urls(
            tmp_path,
            [{"path": "missing.txt", "url": "http://example.com/put"}],
        )
        assert uploaded == []
        assert failed == ["missing.txt"]

    @pytest.mark.asyncio
    async def test_uploads_present_file(self, tmp_path: Path, monkeypatch):
        (tmp_path / "a.txt").write_text("hello")

        calls = {}

        async def fake_upload(file_path, url):
            calls["path"] = str(file_path)
            calls["url"] = url

        monkeypatch.setattr(
            "executor.envd.api.workspace_files.upload_file_to_url", fake_upload
        )

        uploaded, failed = await sync_files_to_urls(
            tmp_path,
            [{"path": "a.txt", "url": "http://example.com/put"}],
        )
        assert uploaded == ["a.txt"]
        assert failed == []
        assert calls["url"] == "http://example.com/put"
