// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useMemo } from 'react'
import { useTaskSession } from '@/features/tasks/session/TaskSession'
import { extractWebSearchSessions } from '@/features/tasks/components/web-search/extractWebSearchSessions'
import { useWebSearchResults } from '@/features/tasks/session/WebSearchResultsContext'

interface WebSearchResultsSyncProps {
  taskId?: number | null
}

export function WebSearchResultsSync({ taskId: taskIdProp }: WebSearchResultsSyncProps) {
  const { selectedTask, selectedTaskDetail, messages, currentTaskId } = useTaskSession()
  const taskId = taskIdProp ?? selectedTask?.id ?? selectedTaskDetail?.id
  const { syncSessions } = useWebSearchResults()

  const activeMessages = useMemo(() => {
    if (taskId == null || currentTaskId !== taskId) {
      return undefined
    }
    return messages
  }, [taskId, currentTaskId, messages])

  const sessions = useMemo(() => extractWebSearchSessions(activeMessages), [activeMessages])

  useEffect(() => {
    syncSessions(sessions)
  }, [sessions, syncSessions])

  return null
}
