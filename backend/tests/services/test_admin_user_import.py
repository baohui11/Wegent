# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

import pytest

from app.services.admin_user_import import parse_users_csv


@pytest.mark.unit
def test_parse_users_csv_valid_rows() -> None:
    content = """user_name,password,email,real_name,department_name,role
alice,secret12,alice@example.com,Alice,Engineering,user
bob,secret34,,Bob,Sales,admin
"""
    rows, failures = parse_users_csv(content)

    assert failures == []
    assert len(rows) == 2
    assert rows[0].user_name == "alice"
    assert rows[0].real_name == "Alice"
    assert rows[0].department_name == "Engineering"
    assert rows[0].role == "user"
    assert rows[1].user_name == "bob"
    assert rows[1].email is None
    assert rows[1].role == "admin"


@pytest.mark.unit
def test_parse_users_csv_chinese_headers() -> None:
    content = """用户名,密码,姓名,部门
zhangsan,pass123,张三,研发部
"""
    rows, failures = parse_users_csv(content)

    assert failures == []
    assert len(rows) == 1
    assert rows[0].user_name == "zhangsan"
    assert rows[0].real_name == "张三"
    assert rows[0].department_name == "研发部"


@pytest.mark.unit
def test_parse_users_csv_missing_required_column() -> None:
    content = "email,real_name\na@example.com,Alice\n"
    rows, failures = parse_users_csv(content)

    assert rows == []
    assert len(failures) == 1
    assert "user_name" in failures[0].error


@pytest.mark.unit
def test_parse_users_csv_duplicate_username_in_file() -> None:
    content = """user_name,password
dup,secret12
dup,secret34
"""
    rows, failures = parse_users_csv(content)

    assert len(rows) == 1
    assert len(failures) == 1
    assert failures[0].user_name == "dup"
    assert "Duplicate" in failures[0].error


@pytest.mark.unit
def test_parse_users_csv_invalid_role() -> None:
    content = """user_name,password,role
user1,secret12,superadmin
"""
    rows, failures = parse_users_csv(content)

    assert rows == []
    assert len(failures) == 1
    assert "role" in failures[0].error
