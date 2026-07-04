# SPDX-License-Identifier: Apache-2.0
"""Resolve a Model CRD -> (model_id, model_config) for bid specialists.

Bid specialists call chat_shell via ``complete_text(model=, model_config=)``.
chat_shell needs a *credential-bearing* model_config (decrypted api_key,
base_url, model_id, provider). ``ModelAggregationService.resolve_model`` strips
the sensitive ``env`` block, so it cannot be used here. Instead we mirror the
canonical resolution used by prompt_draft: look up the Model Kind by name
(own or public/user_id=0) and run the shared
``extract_and_process_model_config`` which decrypts env and resolves
placeholders.
"""

from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User


def resolve_tender_model(db: Session, user: User) -> Tuple[str, Optional[dict]]:
    name = settings.BID_TENDER_MODEL_NAME
    if not name:
        # Caller falls back to chat_shell default handling.
        return "", None

    from app.models.kind import Kind
    from app.services.chat.config import extract_and_process_model_config

    model_kind = (
        db.query(Kind)
        .filter(
            Kind.kind == "Model",
            Kind.name == name,
            Kind.is_active.is_(True),
            Kind.user_id.in_([user.id, 0]),
        )
        .first()
    )
    if model_kind is None:
        return name, None

    model_spec = (model_kind.json or {}).get("spec", {})
    model_config = extract_and_process_model_config(
        model_spec=model_spec,
        user_id=user.id,
        user_name=user.user_name or "",
    )
    model_id = str((model_config or {}).get("model_id") or "").strip() or name
    return model_id, model_config


def resolve_project_model(
    db: Session, user: User, project
) -> Tuple[str, Optional[dict]]:
    """Prefer the project's chosen Model; fall back to the global default.

    Mirrors resolve_tender_model's lookup but keyed off ``project.model_name``
    so each bid project can pin its own model from the UI.
    """
    name = (getattr(project, "model_name", "") or "").strip()
    if not name:
        return resolve_tender_model(db, user)

    from app.models.kind import Kind
    from app.services.chat.config import extract_and_process_model_config

    model_kind = (
        db.query(Kind)
        .filter(
            Kind.kind == "Model",
            Kind.name == name,
            Kind.is_active.is_(True),
            Kind.user_id.in_([user.id, 0]),
        )
        .first()
    )
    if model_kind is None:
        return name, None

    spec = (model_kind.json or {}).get("spec", {})
    cfg = extract_and_process_model_config(
        model_spec=spec, user_id=user.id, user_name=user.user_name or ""
    )
    mid = str((cfg or {}).get("model_id") or "").strip() or name
    return mid, cfg


def validate_model_config(model: str, model_config: Optional[dict]) -> None:
    """Fail fast if the resolved model has no usable credentials.

    Otherwise chat_shell silently returns lifecycle-only SSE (the real-machine
    failure we hit: model resolves to a name but no key -> provider rejects).
    """
    if not model_config or not (
        model_config.get("api_key")
        or model_config.get("base_url")
        or model_config.get("env")
    ):
        raise ValueError(
            f"模型 '{model}' 未解析出有效凭证，请在项目设置里选择一个已配置密钥的模型"
        )
