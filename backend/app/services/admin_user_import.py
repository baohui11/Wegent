# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""CSV bulk import helpers for admin user management."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Set

USERNAME_KEYS = frozenset({"user_name", "username", "login", "account", "用户名"})
PASSWORD_KEYS = frozenset({"password", "密码"})
EMAIL_KEYS = frozenset({"email", "mail", "邮箱"})
REAL_NAME_KEYS = frozenset({"real_name", "name", "display_name", "姓名"})
DEPARTMENT_KEYS = frozenset({"department_name", "department", "部门", "部门名称"})
ROLE_KEYS = frozenset({"role", "角色"})

REQUIRED_COLUMNS = USERNAME_KEYS | PASSWORD_KEYS


@dataclass
class ParsedUserImportRow:
    """Normalized row parsed from CSV."""

    row_number: int
    user_name: str
    password: str
    email: Optional[str] = None
    real_name: Optional[str] = None
    department_name: Optional[str] = None
    role: str = "user"


@dataclass
class UserImportParseFailure:
    row_number: int
    user_name: Optional[str]
    error: str


def _normalize_header(value: str) -> str:
    return value.strip().lower().replace("\ufeff", "")


def _map_headers(headers: Iterable[str]) -> Dict[str, str]:
    """Map CSV header cells to canonical field names."""
    mapping: Dict[str, str] = {}
    for header in headers:
        normalized = _normalize_header(header)
        if not normalized:
            continue
        if normalized in USERNAME_KEYS:
            mapping[header] = "user_name"
        elif normalized in PASSWORD_KEYS:
            mapping[header] = "password"
        elif normalized in EMAIL_KEYS:
            mapping[header] = "email"
        elif normalized in REAL_NAME_KEYS:
            mapping[header] = "real_name"
        elif normalized in DEPARTMENT_KEYS:
            mapping[header] = "department_name"
        elif normalized in ROLE_KEYS:
            mapping[header] = "role"
    return mapping


def _empty_to_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def parse_users_csv(
    content: str,
) -> tuple[List[ParsedUserImportRow], List[UserImportParseFailure]]:
    """Parse CSV content into normalized user rows."""
    text = content.lstrip("\ufeff")
    if not text.strip():
        return [], [UserImportParseFailure(1, None, "CSV file is empty")]

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], [UserImportParseFailure(1, None, "CSV header row is required")]

    header_map = _map_headers(reader.fieldnames)
    mapped_fields = set(header_map.values())
    if not mapped_fields.intersection({"user_name"}):
        return [], [
            UserImportParseFailure(1, None, "Missing required column: user_name")
        ]
    if not mapped_fields.intersection({"password"}):
        return [], [
            UserImportParseFailure(1, None, "Missing required column: password")
        ]

    rows: List[ParsedUserImportRow] = []
    failures: List[UserImportParseFailure] = []
    seen_usernames: Set[str] = set()

    for index, raw_row in enumerate(reader, start=2):
        if not raw_row or not any((value or "").strip() for value in raw_row.values()):
            continue

        normalized: Dict[str, str] = {}
        for source_header, canonical in header_map.items():
            normalized[canonical] = (raw_row.get(source_header) or "").strip()

        user_name = normalized.get("user_name", "")
        password = normalized.get("password", "")

        if not user_name:
            failures.append(
                UserImportParseFailure(index, None, "user_name is required")
            )
            continue
        if len(user_name) < 2 or len(user_name) > 50:
            failures.append(
                UserImportParseFailure(
                    index, user_name, "user_name must be between 2 and 50 characters"
                )
            )
            continue
        if user_name in seen_usernames:
            failures.append(
                UserImportParseFailure(
                    index, user_name, "Duplicate user_name in CSV file"
                )
            )
            continue
        if not password:
            failures.append(
                UserImportParseFailure(index, user_name, "password is required")
            )
            continue
        if len(password) < 6:
            failures.append(
                UserImportParseFailure(
                    index, user_name, "password must be at least 6 characters"
                )
            )
            continue

        role = (normalized.get("role") or "user").lower()
        if role not in {"admin", "user"}:
            failures.append(
                UserImportParseFailure(
                    index, user_name, "role must be either 'admin' or 'user'"
                )
            )
            continue

        seen_usernames.add(user_name)
        rows.append(
            ParsedUserImportRow(
                row_number=index,
                user_name=user_name,
                password=password,
                email=_empty_to_none(normalized.get("email")),
                real_name=_empty_to_none(normalized.get("real_name")),
                department_name=_empty_to_none(normalized.get("department_name")),
                role=role,
            )
        )

    return rows, failures
