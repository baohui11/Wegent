# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
Search service module for web search integration.
"""

from .base import SearchServiceBase
from .factory import (
    get_available_engines,
    get_default_engine_name,
    get_search_service,
    get_tavily_extract_service,
)

__all__ = [
    "SearchServiceBase",
    "get_available_engines",
    "get_default_engine_name",
    "get_search_service",
    "get_tavily_extract_service",
]
