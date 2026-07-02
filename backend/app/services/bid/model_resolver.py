# SPDX-License-Identifier: Apache-2.0
"""Resolve a Model CRD -> (model_name, model_config) for bid specialists.

NOTE: adjusted to the actual ModelAggregationService API in this repo
(app/services/model_aggregation_service.py). The service exposes
``resolve_model(db, current_user, name, model_type=None)`` returning a
``to_full_dict()`` payload (keys include ``config`` and ``name``), not a
``get_model_config(user=, name=)`` method.
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
    from app.services.model_aggregation_service import ModelAggregationService

    svc = ModelAggregationService(db)
    resolved = svc.resolve_model(db, current_user=user, name=name)
    if not resolved:
        return name, None
    cfg = resolved.get("config") or None
    model_name = (cfg or {}).get("model") or resolved.get("name") or name
    return model_name, cfg
