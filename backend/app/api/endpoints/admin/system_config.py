# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""Admin system configuration endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.security import get_admin_user
from app.models.system_config import SystemConfig
from app.models.user import User
from app.schemas.admin import (
    AdminSetupCompleteResponse,
    ChatSloganItem,
    ChatSloganTipsResponse,
    ChatSloganTipsUpdate,
    ChatTipItem,
    SystemConfigResponse,
    SystemConfigUpdate,
)
from app.schemas.quick_launch import (
    QuickLaunchFunctionsResponse,
    QuickLaunchFunctionsUpdate,
)

router = APIRouter()

# Config keys
QUICK_ACCESS_CONFIG_KEY = "quick_access_recommended"
QUICK_LAUNCH_FUNCTIONS_CONFIG_KEY = "quick_launch_functions"
CHAT_SLOGAN_TIPS_CONFIG_KEY = "chat_slogan_tips"
ADMIN_SETUP_CONFIG_KEY = "admin_setup_completed"

# Default slogan and tips configuration
DEFAULT_SLOGAN_TIPS_CONFIG = {
    "slogans": [
        {
            "id": 1,
            "zh": "今天有什么可以帮到你？",
            "en": "What can I help you with today?",
            "mode": "chat",
        },
        {
            "id": 2,
            "zh": "有什么任务我们一起推进？",
            "en": "What should we work on together?",
            "mode": "code",
        },
    ],
    "tips": [
        {
            "id": 1,
            "zh": "可以直接提问，我会帮你梳理思路、整理要点",
            "en": "Ask anything—I can help you organize ideas and key points",
            "mode": "chat",
        },
        {
            "id": 2,
            "zh": "上传文档、报告或表格，我可以帮你阅读、摘要和分析",
            "en": "Upload documents, reports, or spreadsheets for reading, summaries, and analysis",
            "mode": "chat",
        },
        {
            "id": 3,
            "zh": "我可以协助撰写邮件、会议纪要或对内对外材料",
            "en": "I can help draft emails, meeting notes, or internal and client-facing materials",
            "mode": "chat",
        },
        {
            "id": 4,
            "zh": "试试说：帮我拆解这个项目的关键步骤和交付物",
            "en": "Try: Help me break down the key steps and deliverables for this project",
            "mode": "code",
        },
        {
            "id": 5,
            "zh": "我可以帮你生成文档、网页等内容",
            "en": "I can help you generate documents, web pages, and similar content",
            "mode": "code",
        },
        {
            "id": 6,
            "zh": "试试让我对比几种方案，列出优劣与建议",
            "en": "Try asking me to compare options with pros, cons, and recommendations",
            "mode": "code",
        },
        {
            "id": 7,
            "zh": "我可以帮你整理调研资料，提炼结论与行动建议",
            "en": "I can organize research materials and distill conclusions and action items",
            "mode": "code",
        },
        {
            "id": 8,
            "zh": "选择合适的智能体，可以更快得到更贴合业务的回答",
            "en": "Choosing the right agent helps you get answers that better fit your work",
            "mode": "both",
        },
    ],
}


@router.get("/system-config/quick-access", response_model=SystemConfigResponse)
async def get_quick_access_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """
    Get system recommended quick access configuration
    """
    config = (
        db.query(SystemConfig)
        .filter(SystemConfig.config_key == QUICK_ACCESS_CONFIG_KEY)
        .first()
    )
    if not config:
        return SystemConfigResponse(version=0, teams=[])

    config_value = config.config_value or {}
    return SystemConfigResponse(
        version=config.version,
        teams=config_value.get("teams", []),
    )


@router.put("/system-config/quick-access", response_model=SystemConfigResponse)
async def update_quick_access_config(
    config_data: SystemConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """
    Update system recommended quick access configuration (admin only).
    Version number is automatically incremented.
    """
    config = (
        db.query(SystemConfig)
        .filter(SystemConfig.config_key == QUICK_ACCESS_CONFIG_KEY)
        .first()
    )

    if not config:
        # Create new config
        config = SystemConfig(
            config_key=QUICK_ACCESS_CONFIG_KEY,
            config_value={"teams": config_data.teams},
            version=1,
            updated_by=current_user.id,
        )
        db.add(config)
    else:
        # Update existing config and increment version
        config.config_value = {"teams": config_data.teams}
        config.version = config.version + 1
        config.updated_by = current_user.id

    db.commit()
    db.refresh(config)

    return SystemConfigResponse(
        version=config.version,
        teams=config.config_value.get("teams", []),
    )


@router.get(
    "/system-config/quick-launch-functions",
    response_model=QuickLaunchFunctionsResponse,
)
async def get_quick_launch_functions_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """
    Get system function launchers shown in the homepage QuickCard.
    """
    config = (
        db.query(SystemConfig)
        .filter(SystemConfig.config_key == QUICK_LAUNCH_FUNCTIONS_CONFIG_KEY)
        .first()
    )
    if not config:
        return QuickLaunchFunctionsResponse(version=0, functions=[])

    config_value = config.config_value or {}
    return QuickLaunchFunctionsResponse(
        version=config.version,
        functions=config_value.get("functions", []),
    )


@router.put(
    "/system-config/quick-launch-functions",
    response_model=QuickLaunchFunctionsResponse,
)
async def update_quick_launch_functions_config(
    config_data: QuickLaunchFunctionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """
    Update system function launchers shown in the homepage QuickCard.
    """
    config_value = {
        "functions": [function.model_dump() for function in config_data.functions]
    }
    config = (
        db.query(SystemConfig)
        .filter(SystemConfig.config_key == QUICK_LAUNCH_FUNCTIONS_CONFIG_KEY)
        .first()
    )

    if not config:
        config = SystemConfig(
            config_key=QUICK_LAUNCH_FUNCTIONS_CONFIG_KEY,
            config_value=config_value,
            version=1,
            updated_by=current_user.id,
        )
        db.add(config)
    else:
        config.config_value = config_value
        config.version = config.version + 1
        config.updated_by = current_user.id

    db.commit()
    db.refresh(config)

    return QuickLaunchFunctionsResponse(
        version=config.version,
        functions=config_value["functions"],
    )


@router.get("/system-config/slogan-tips", response_model=ChatSloganTipsResponse)
async def get_slogan_tips_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """
    Get chat slogan and tips configuration
    """
    config = (
        db.query(SystemConfig)
        .filter(SystemConfig.config_key == CHAT_SLOGAN_TIPS_CONFIG_KEY)
        .first()
    )
    if not config:
        # Return default configuration
        return ChatSloganTipsResponse(
            version=0,
            slogans=[
                ChatSloganItem(**s) for s in DEFAULT_SLOGAN_TIPS_CONFIG["slogans"]
            ],
            tips=[ChatTipItem(**tip) for tip in DEFAULT_SLOGAN_TIPS_CONFIG["tips"]],
        )

    config_value = config.config_value or {}
    return ChatSloganTipsResponse(
        version=config.version,
        slogans=[
            ChatSloganItem(**s)
            for s in config_value.get("slogans", DEFAULT_SLOGAN_TIPS_CONFIG["slogans"])
        ],
        tips=[ChatTipItem(**tip) for tip in config_value.get("tips", [])],
    )


@router.put("/system-config/slogan-tips", response_model=ChatSloganTipsResponse)
async def update_slogan_tips_config(
    config_data: ChatSloganTipsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """
    Update chat slogan and tips configuration (admin only).
    Version number is automatically incremented.
    """
    config = (
        db.query(SystemConfig)
        .filter(SystemConfig.config_key == CHAT_SLOGAN_TIPS_CONFIG_KEY)
        .first()
    )

    config_value = {
        "slogans": [s.model_dump() for s in config_data.slogans],
        "tips": [tip.model_dump() for tip in config_data.tips],
    }

    if not config:
        # Create new config
        config = SystemConfig(
            config_key=CHAT_SLOGAN_TIPS_CONFIG_KEY,
            config_value=config_value,
            version=1,
            updated_by=current_user.id,
        )
        db.add(config)
    else:
        # Update existing config and increment version
        config.config_value = config_value
        config.version = config.version + 1
        config.updated_by = current_user.id

    db.commit()
    db.refresh(config)

    return ChatSloganTipsResponse(
        version=config.version,
        slogans=config_data.slogans,
        tips=config_data.tips,
    )


# ==================== Admin Setup Wizard Endpoints ====================


@router.post("/setup-complete", response_model=AdminSetupCompleteResponse)
async def mark_admin_setup_complete(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """
    Mark admin setup wizard as completed.
    This will prevent the wizard from showing on subsequent admin logins.

    Returns:
        AdminSetupCompleteResponse: Contains success status and message
    """
    config = (
        db.query(SystemConfig)
        .filter(SystemConfig.config_key == ADMIN_SETUP_CONFIG_KEY)
        .first()
    )

    if config:
        # Update existing config
        config.config_value = {"completed": True}
        config.updated_by = current_user.id
        config.version += 1
    else:
        # Create new config
        config = SystemConfig(
            config_key=ADMIN_SETUP_CONFIG_KEY,
            updated_by=current_user.id,
        )
        config.config_value = {"completed": True}
        db.add(config)

    db.commit()

    return AdminSetupCompleteResponse(
        success=True,
        message="Admin setup wizard marked as completed",
    )
