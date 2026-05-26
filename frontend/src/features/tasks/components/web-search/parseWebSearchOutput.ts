// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import type { WebSearchResultItem } from './types'

interface ParsedWebSearchPayload {
  query?: string
  count?: number
  error?: string
  results?: unknown[]
}

function normalizeResultItem(raw: unknown): WebSearchResultItem | null {
  if (!raw || typeof raw !== 'object') return null

  const item = raw as Record<string, unknown>
  const title = String(item.title ?? '').trim()
  const url = String(item.url ?? '').trim()
  const snippet = String(item.snippet ?? item.summary ?? item.content ?? '').trim()

  if (!title && !url && !snippet) return null

  return {
    title,
    url,
    snippet,
    content: item.content ? String(item.content) : undefined,
    siteName: item.siteName
      ? String(item.siteName)
      : item.site_name
        ? String(item.site_name)
        : item.source
          ? String(item.source)
          : undefined,
    publishedDate: item.publishedDate
      ? String(item.publishedDate)
      : item.published_date
        ? String(item.published_date)
        : item.date
          ? String(item.date)
          : undefined,
  }
}

export function parseWebSearchOutput(raw: unknown): {
  query?: string
  count: number
  results: WebSearchResultItem[]
  error?: string
} {
  if (raw == null) {
    return { count: 0, results: [] }
  }

  let payload: ParsedWebSearchPayload
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw) as ParsedWebSearchPayload
    } catch {
      return { count: 0, results: [], error: raw }
    }
  } else if (typeof raw === 'object') {
    payload = raw as ParsedWebSearchPayload
  } else {
    return { count: 0, results: [] }
  }

  if (payload.error) {
    return {
      query: payload.query,
      count: 0,
      results: [],
      error: payload.error,
    }
  }

  const results = Array.isArray(payload.results)
    ? payload.results
        .map(normalizeResultItem)
        .filter((item): item is WebSearchResultItem => item !== null)
    : []

  const count = typeof payload.count === 'number' ? payload.count : results.length

  return {
    query: payload.query,
    count,
    results,
  }
}
