# SPDX-License-Identifier: Apache-2.0
"""Agentic drafting settings (Phase 2)."""

from app.core.config import settings


def test_agentic_drafting_defaults():
    # opt-in: pipeline stays the default until validated in a real deploy
    assert settings.BID_DRAFTING_MODE == "pipeline"
    assert settings.BID_AGENTIC_TIMEOUT_S == 420
    assert settings.BID_AGENTIC_USABLE_MIN == 500
    assert settings.BID_AGENTIC_MAX_ITERS == 40
    assert isinstance(settings.BID_PI_RUNTIME_URL, str)
    assert settings.BID_PI_RUNTIME_URL  # non-empty
