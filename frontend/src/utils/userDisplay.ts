// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

export interface UserDisplayFields {
  user_name?: string | null
  real_name?: string | null
  department_name?: string | null
  /** Inbox / queue payloads use camelCase */
  userName?: string | null
  realName?: string | null
  departmentName?: string | null
}

export function getUserDisplayName(user?: UserDisplayFields | null, fallback = ''): string {
  if (!user) return fallback
  const realName = user.real_name ?? user.realName
  if (typeof realName === 'string' && realName.trim()) {
    return realName.trim()
  }
  const userName = user.user_name ?? user.userName
  if (typeof userName === 'string' && userName.trim()) {
    return userName.trim()
  }
  return fallback
}

export function getUserDepartmentName(user?: UserDisplayFields | null): string {
  if (!user) return ''
  const department = user.department_name ?? user.departmentName
  return typeof department === 'string' ? department.trim() : ''
}

export function formatUserDisplayLabel(user?: UserDisplayFields | null, fallback = ''): string {
  const name = getUserDisplayName(user, fallback)
  const department = getUserDepartmentName(user)
  if (!department) return name
  return `${name} · ${department}`
}
