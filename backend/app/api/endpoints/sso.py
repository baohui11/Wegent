# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""FastGPT single sign-on (SSO) endpoints.

Implements a lightweight, shared-secret token based SSO that lets FastGPT log
its already-authenticated users into Wegent without reusing the OIDC flow.

Trust model:
- FastGPT and Wegent share a secret (``FASTGPT_SSO_SECRET``).
- FastGPT signs a short-lived HS256 JWT asserting the current ``username`` and
  hands it to the browser, which is redirected to ``/api/auth/sso/fastgpt``.
- Wegent verifies the signature / expiry / issuer, looks the user up by
  ``user_name`` and, when found, mints a normal Wegent JWT and reuses the
  existing ``/login/oidc`` token-ingestion page to complete the login.

Unlike the OIDC callback, this flow never auto-provisions users: existence is
decided by FastGPT (via ``/api/auth/sso/check``) and unknown users are routed to
FastGPT's own "upgrading" page.
"""

from __future__ import annotations

import hmac
import logging
from typing import Optional

import jwt  # PyJWT
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.config import settings
from app.core.security import create_access_token
from app.models.user import User
from app.schemas.user import UserAuthTypeResponse

logger = logging.getLogger(__name__)

router = APIRouter()

# Token issued by FastGPT must declare this issuer.
FASTGPT_SSO_ISSUER = "fastgpt"

_security = HTTPBearer(auto_error=False)


def _shared_secret() -> str:
    return (settings.FASTGPT_SSO_SECRET or "").strip()


def _build_frontend_url(path: str) -> str:
    base_url = settings.FRONTEND_URL.rstrip("/")
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{base_url}{normalized_path}"


def require_shared_secret(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
) -> None:
    """Authenticate server-to-server calls from FastGPT via the shared secret."""
    expected = _shared_secret()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FastGPT SSO is not configured",
        )
    if credentials is None or not hmac.compare_digest(
        credentials.credentials, expected
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid SSO credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.get("/check", response_model=UserAuthTypeResponse)
def check_user_exists(
    username: str = Query(..., description="Username to check"),
    db: Session = Depends(get_db),
    _: None = Depends(require_shared_secret),
):
    """Return whether a Wegent user with ``username`` exists.

    Called server-to-server by FastGPT to decide whether to start SSO or route
    the user to the "upgrading" page. Secured by the shared secret to avoid open
    user enumeration.
    """
    user = db.scalar(select(User).where(User.user_name == username))
    if not user:
        return UserAuthTypeResponse(exists=False, auth_source=None)
    return UserAuthTypeResponse(exists=True, auth_source=user.auth_source)


@router.get("/fastgpt")
def fastgpt_sso_login(
    token: str = Query(..., description="Signed SSO assertion from FastGPT"),
    db: Session = Depends(get_db),
):
    """Complete browser SSO from FastGPT.

    Verifies the signed assertion, then logs the matching Wegent user in by
    minting a Wegent JWT and redirecting to the ``/login/oidc`` token-ingestion
    page. Unknown / inactive users are bounced back to the login page (the
    primary "upgrading" routing happens on the FastGPT side).
    """
    secret = _shared_secret()
    if not secret:
        logger.error("FastGPT SSO attempted but FASTGPT_SSO_SECRET is not configured")
        return RedirectResponse(
            url=_build_frontend_url("/login?error=sso_unavailable"),
            status_code=302,
        )

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            issuer=FASTGPT_SSO_ISSUER,
            options={"require": ["exp", "sub", "iss"]},
        )
    except jwt.PyJWTError as exc:
        logger.warning("Rejected FastGPT SSO token: %s", exc)
        return RedirectResponse(
            url=_build_frontend_url("/login?error=invalid_sso_token"),
            status_code=302,
        )

    username = payload.get("sub")
    user = db.scalar(select(User).where(User.user_name == username))

    if user is None or not user.is_active:
        # Edge case: FastGPT should have filtered these out via /check, but fail
        # safe by sending the browser to the login page instead of provisioning.
        logger.info("FastGPT SSO user not eligible: username=%s", username)
        return RedirectResponse(
            url=_build_frontend_url("/login?error=user_not_found"),
            status_code=302,
        )

    jwt_token = create_access_token(data={"sub": user.user_name, "user_id": user.id})
    logger.info(
        "FastGPT SSO login success: user_id=%s, user_name=%s", user.id, user.user_name
    )

    redirect_url = _build_frontend_url(
        f"/login/oidc?access_token={jwt_token}&token_type=bearer"
        "&login_success=true&redirect=/chat"
    )
    return RedirectResponse(url=redirect_url, status_code=302)
