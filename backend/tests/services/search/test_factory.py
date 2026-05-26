# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for search service factory."""

import json

import pytest

from app.services.search.bocha_search import BochaSearchService
from app.services.search.factory import _create_search_service, get_search_service
from app.services.search.http_search import HttpSearchService


@pytest.fixture(autouse=True)
def reset_factory_cache():
    import app.services.search.factory as factory_module

    factory_module._search_services.clear()
    factory_module._engines_config = None
    yield
    factory_module._search_services.clear()
    factory_module._engines_config = None


def test_create_http_search_service():
    service = _create_search_service(
        "searxng",
        {
            "base_url": "http://searxng:8080/search",
            "query_param": "q",
            "response_path": "results",
        },
    )

    assert isinstance(service, HttpSearchService)


def test_create_bocha_search_service_with_api_key(monkeypatch):
    monkeypatch.setattr(
        "app.services.search.factory.settings.BOCHA_API_KEY",
        "sk-test",
    )

    service = _create_search_service(
        "bocha",
        {
            "type": "bocha",
            "freshness": "oneWeek",
            "summary": False,
        },
    )

    assert isinstance(service, BochaSearchService)
    assert service.freshness == "oneWeek"
    assert service.summary is False


def test_create_bocha_search_service_missing_api_key(monkeypatch):
    monkeypatch.setattr(
        "app.services.search.factory.settings.BOCHA_API_KEY",
        "",
    )

    service = _create_search_service("bocha", {"type": "bocha"})
    assert service is None


def test_get_search_service_uses_default_engine(monkeypatch):
    monkeypatch.setattr(
        "app.services.search.factory.settings.WEB_SEARCH_ENABLED",
        True,
    )
    monkeypatch.setattr(
        "app.services.search.factory.settings.WEB_SEARCH_ENGINES",
        json.dumps(
            {
                "default": "bocha",
                "engines": {
                    "bocha": {"type": "bocha", "display_name": "博查"},
                    "searxng": {
                        "base_url": "http://searxng/search",
                    },
                },
            }
        ),
    )
    monkeypatch.setattr(
        "app.services.search.factory.settings.BOCHA_API_KEY",
        "sk-test",
    )

    service = get_search_service()
    assert isinstance(service, BochaSearchService)

    service_by_name = get_search_service("searxng")
    assert isinstance(service_by_name, HttpSearchService)
