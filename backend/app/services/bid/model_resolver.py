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
