# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests for search service factory."""

import json

import pytest

from app.services.search.bocha_search import BochaSearchService
from app.services.search.factory import (
    _create_search_service,
    get_default_engine_name,
    get_search_service,
    get_tavily_extract_service,
)
from app.services.search.http_search import HttpSearchService


@pytest.fixture(autouse=True)
def reset_factory_cache():
    import app.services.search.factory as factory_module

    factory_module._search_services.clear()
    factory_module._tavily_extract_service = None
    factory_module._engines_config = None
    yield
    factory_module._search_services.clear()
    factory_module._tavily_extract_service = None
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


def test_create_tavily_search_service(monkeypatch):
    monkeypatch.setattr(
        "app.services.search.factory.settings.TAVILY_API_KEY",
        "tvly-test",
    )

    service = _create_search_service(
        "tavily",
        {
            "type": "tavily",
            "auto_parameters": False,
            "include_favicon": False,
            "safe_search": True,
            "include_usage": False,
        },
    )

    from app.services.search.tavily_search import TavilySearchService

    assert isinstance(service, TavilySearchService)
    assert service.auto_parameters is False
    assert service.include_favicon is False
    assert service.safe_search is True
    assert service.include_usage is False


def test_create_tavily_search_service_missing_api_key(monkeypatch):
    monkeypatch.setattr(
        "app.services.search.factory.settings.TAVILY_API_KEY",
        "",
    )

    service = _create_search_service("tavily", {"type": "tavily"})
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


def test_get_tavily_extract_service_requires_api_key(monkeypatch):
    monkeypatch.setattr(
        "app.services.search.factory.settings.WEB_SEARCH_ENABLED",
        True,
    )
    monkeypatch.setattr(
        "app.services.search.factory.settings.TAVILY_API_KEY",
        "",
    )

    assert get_tavily_extract_service() is None


def test_get_tavily_extract_service_success(monkeypatch):
    monkeypatch.setattr(
        "app.services.search.factory.settings.WEB_SEARCH_ENABLED",
        True,
    )
    monkeypatch.setattr(
        "app.services.search.factory.settings.TAVILY_API_KEY",
        "tvly-test",
    )

    from app.services.search.tavily_extract import TavilyExtractService

    service = get_tavily_extract_service()
    assert isinstance(service, TavilyExtractService)


def test_get_search_service_tavily_default_engine(monkeypatch):
    monkeypatch.setattr(
        "app.services.search.factory.settings.WEB_SEARCH_ENABLED",
        True,
    )
    monkeypatch.setattr(
        "app.services.search.factory.settings.WEB_SEARCH_ENGINES",
        json.dumps(
            {
                "default": "tavily",
                "engines": {
                    "tavily": {"type": "tavily", "display_name": "Tavily"},
                },
            }
        ),
    )
    monkeypatch.setattr(
        "app.services.search.factory.settings.TAVILY_API_KEY",
        "tvly-test",
    )

    from app.services.search.tavily_search import TavilySearchService

    service = get_search_service()
    assert isinstance(service, TavilySearchService)


def test_get_default_engine_name(monkeypatch):
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
                    "bocha": {"type": "bocha"},
                    "searxng": {"base_url": "http://searxng/search"},
                },
            }
        ),
    )
    monkeypatch.setattr(
        "app.services.search.factory.settings.BOCHA_API_KEY",
        "sk-test",
    )

    assert get_default_engine_name() == "bocha"
