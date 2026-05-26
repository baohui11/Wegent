// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useMemo } from 'react'
import { useTaskContext } from '@/features/tasks/contexts/taskContext'
import { useTaskStateMachine } from '@/features/tasks/hooks/useTaskStateMachine'
import { extractWebSearchSessions } from '@/features/tasks/components/web-search/extractWebSearchSessions'
import { useWebSearchResults } from '@/features/tasks/contexts/WebSearchResultsContext'

interface WebSearchResultsSyncProps {
  taskId?: number | null
}

export function WebSearchResultsSync({ taskId: taskIdProp }: WebSearchResultsSyncProps) {
  const { selectedTask, selectedTaskDetail } = useTaskContext()
  const taskId = taskIdProp ?? selectedTask?.id ?? selectedTaskDetail?.id
  const { messages } = useTaskStateMachine(taskId)
  const { syncSessions } = useWebSearchResults()

  const sessions = useMemo(() => extractWebSearchSessions(messages), [messages])

  useEffect(() => {
    syncSessions(sessions)
  }, [sessions, syncSessions])

  return null
}
