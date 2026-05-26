// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
  content?: string
  siteName?: string
  publishedDate?: string
}

export type WebSearchSessionStatus = 'loading' | 'done' | 'error'

export interface WebSearchSession {
  id: string
  query: string
  status: WebSearchSessionStatus
  results: WebSearchResultItem[]
  count: number
  error?: string
  timestamp?: number
}

/** Whether a session should appear in the right-side results panel */
export function isWebSearchSessionPanelVisible(session: WebSearchSession): boolean {
  if (session.status === 'loading') return true
  if (session.status === 'error' || session.error) return false
  return session.results.length > 0
}
