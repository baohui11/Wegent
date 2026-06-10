// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import { cn } from '@/lib/utils'
import {
  getUserDepartmentName,
  getUserDisplayName,
  type UserDisplayFields,
} from '@/utils/userDisplay'

export interface UserIdentityProps {
  user?: UserDisplayFields | null
  fallback?: string
  className?: string
  nameClassName?: string
  departmentClassName?: string
  /** Inline layout for badges and compact rows */
  compact?: boolean
  /** Hide department even when present */
  hideDepartment?: boolean
}

export function UserIdentity({
  user,
  fallback = '',
  className,
  nameClassName,
  departmentClassName,
  compact = false,
  hideDepartment = false,
}: UserIdentityProps) {
  const name = getUserDisplayName(user, fallback)
  const department = hideDepartment ? '' : getUserDepartmentName(user)

  if (compact) {
    return (
      <span className={cn('inline-flex min-w-0 items-baseline gap-1', className)}>
        <span className={cn('truncate', nameClassName)}>{name}</span>
        {department ? (
          <span className={cn('truncate text-xs text-text-muted', departmentClassName)}>
            {department}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <span className={cn('inline-flex min-w-0 flex-col', className)}>
      <span className={cn('truncate', nameClassName)}>{name}</span>
      {department ? (
        <span className={cn('truncate text-xs text-text-muted', departmentClassName)}>
          {department}
        </span>
      ) : null}
    </span>
  )
}

export {
  getUserDisplayName,
  getUserDepartmentName,
  formatUserDisplayLabel,
} from '@/utils/userDisplay'
