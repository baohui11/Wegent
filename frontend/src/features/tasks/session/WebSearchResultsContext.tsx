// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { WebSearchSession } from '@/features/tasks/components/web-search/types'
import { isWebSearchSessionPanelVisible } from '@/features/tasks/components/web-search/types'

interface WebSearchResultsContextValue {
  sessions: WebSearchSession[]
  activeSession: WebSearchSession | null
  activeSessionId: string | null
  isPanelOpen: boolean
  hasSessions: boolean
  syncSessions: (sessions: WebSearchSession[]) => void
  selectSession: (sessionId: string) => void
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
}

const WebSearchResultsContext = createContext<WebSearchResultsContextValue | null>(null)

export function WebSearchResultsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<WebSearchSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const previousSessionIdsRef = useRef<Set<string>>(new Set())
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const syncSessions = useCallback((incomingSessions: WebSearchSession[]) => {
    const visibleSessions = incomingSessions.filter(isWebSearchSessionPanelVisible)
    setSessions(visibleSessions)

    if (visibleSessions.length === 0) {
      setActiveSessionId(null)
      setIsPanelOpen(false)
      previousSessionIdsRef.current = new Set()
      return
    }

    const incomingIds = new Set(visibleSessions.map(session => session.id))
    const hasNewSession = visibleSessions.some(
      session => !previousSessionIdsRef.current.has(session.id)
    )
    const hasLoadingSession = visibleSessions.some(session => session.status === 'loading')
    previousSessionIdsRef.current = incomingIds

    setActiveSessionId(currentId => {
      if (currentId && visibleSessions.some(session => session.id === currentId)) {
        return currentId
      }
      return visibleSessions[visibleSessions.length - 1]?.id ?? null
    })

    if (hasNewSession || hasLoadingSession) {
      setIsPanelOpen(true)
    }
  }, [])

  const selectSession = useCallback((sessionId: string) => {
    const session = sessionsRef.current.find(item => item.id === sessionId)
    if (!session || !isWebSearchSessionPanelVisible(session)) return
    setActiveSessionId(sessionId)
    setIsPanelOpen(true)
  }, [])

  const openPanel = useCallback(() => {
    if (sessionsRef.current.length > 0) {
      setIsPanelOpen(true)
    }
  }, [])

  const closePanel = useCallback(() => {
    setIsPanelOpen(false)
  }, [])

  const togglePanel = useCallback(() => {
    setIsPanelOpen(open => !open)
  }, [])

  const activeSession = useMemo(() => {
    if (!activeSessionId) return sessions[sessions.length - 1] ?? null
    return (
      sessions.find(session => session.id === activeSessionId) ??
      sessions[sessions.length - 1] ??
      null
    )
  }, [activeSessionId, sessions])

  const value = useMemo(
    () => ({
      sessions,
      activeSession,
      activeSessionId: activeSession?.id ?? null,
      isPanelOpen,
      hasSessions: sessions.length > 0,
      syncSessions,
      selectSession,
      openPanel,
      closePanel,
      togglePanel,
    }),
    [
      sessions,
      activeSession,
      isPanelOpen,
      syncSessions,
      selectSession,
      openPanel,
      closePanel,
      togglePanel,
    ]
  )

  return (
    <WebSearchResultsContext.Provider value={value}>{children}</WebSearchResultsContext.Provider>
  )
}

export function useWebSearchResults(): WebSearchResultsContextValue {
  const context = useContext(WebSearchResultsContext)
  if (!context) {
    throw new Error('useWebSearchResults must be used within WebSearchResultsProvider')
  }
  return context
}

export function useOptionalWebSearchResults(): WebSearchResultsContextValue | null {
  return useContext(WebSearchResultsContext)
}
