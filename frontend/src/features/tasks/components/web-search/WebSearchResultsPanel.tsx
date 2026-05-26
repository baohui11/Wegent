// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import React from 'react'
import { Loader2, X } from 'lucide-react'
import { useTranslation } from '@/hooks/useTranslation'
import type { WebSearchSession } from './types'
import { WebSearchResultItemCard } from './WebSearchResultItemCard'

interface WebSearchResultsPanelProps {
  isOpen: boolean
  onClose: () => void
  session: WebSearchSession | null
  sessions: WebSearchSession[]
  onSelectSession: (sessionId: string) => void
  variant?: 'sidebar' | 'embedded'
}

export function WebSearchResultsPanelContent({
  onClose,
  session,
  sessions,
  onSelectSession,
}: Omit<WebSearchResultsPanelProps, 'isOpen' | 'variant'>) {
  const { t } = useTranslation('chat')

  const titleCount = session?.count ?? session?.results.length ?? 0
  const panelTitle = t('web_search.panel.title', { count: titleCount })

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text-primary truncate">{panelTitle}</h2>
          {session?.query && (
            <p className="text-xs text-text-muted truncate mt-0.5">{session.query}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-text-muted hover:text-text-primary hover:bg-hover transition-colors flex-shrink-0"
          aria-label={t('web_search.panel.close')}
          data-testid="web-search-panel-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {sessions.length > 1 && (
        <div className="px-4 py-2 border-b border-border flex gap-2 overflow-x-auto custom-scrollbar flex-shrink-0">
          {sessions.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSession(item.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${
                session?.id === item.id
                  ? 'bg-primary/10 text-primary'
                  : 'bg-surface text-text-secondary hover:bg-hover'
              }`}
            >
              {item.query || t('web_search.panel.search_n', { n: index + 1 })}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-2 custom-scrollbar min-h-0">
        {!session ? (
          <div className="py-8 text-center text-sm text-text-muted">
            {t('web_search.panel.empty')}
          </div>
        ) : session.status === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t('web_search.panel.searching')}</span>
          </div>
        ) : session.status === 'error' ? (
          <div className="py-8 text-center text-sm text-error">
            {session.error || t('web_search.panel.error')}
          </div>
        ) : session.results.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-muted">
            {t('web_search.panel.no_results')}
          </div>
        ) : (
          <div>
            {session.results.map((result, index) => (
              <WebSearchResultItemCard
                key={`${result.url}-${index}`}
                result={result}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

export function WebSearchResultsPanel({
  isOpen,
  onClose,
  session,
  sessions,
  onSelectSession,
  variant = 'sidebar',
}: WebSearchResultsPanelProps) {
  if (variant === 'embedded') {
    return (
      <div className="h-full flex flex-col min-h-0" data-testid="web-search-results-panel">
        <WebSearchResultsPanelContent
          onClose={onClose}
          session={session}
          sessions={sessions}
          onSelectSession={onSelectSession}
        />
      </div>
    )
  }

  return (
    <div
      className="transition-all duration-300 ease-in-out bg-surface overflow-hidden flex-shrink-0"
      style={{ width: isOpen ? '40%' : '0' }}
      data-testid="web-search-results-panel"
    >
      {isOpen && (
        <div className="h-full flex flex-col border border-border rounded-lg overflow-hidden">
          <WebSearchResultsPanelContent
            onClose={onClose}
            session={session}
            sessions={sessions}
            onSelectSession={onSelectSession}
          />
        </div>
      )}
    </div>
  )
}

export default WebSearchResultsPanel
