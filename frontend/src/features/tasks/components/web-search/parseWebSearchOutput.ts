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

interface McpContentBlock {
  type?: string
  text?: string
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

function unwrapMcpTextContent(raw: unknown): string | null {
  if (typeof raw === 'string') {
    return raw
  }

  if (Array.isArray(raw)) {
    const texts = raw
      .map(item => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const block = item as McpContentBlock
          if (block.type === 'text' && typeof block.text === 'string') {
            return block.text
          }
        }
        return null
      })
      .filter((value): value is string => Boolean(value))
    return texts.length > 0 ? texts.join('\n') : null
  }

  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>

    if (typeof record.text === 'string') {
      return record.text
    }

    if (Array.isArray(record.content)) {
      return unwrapMcpTextContent(record.content)
    }

    if (typeof record.content === 'string') {
      return record.content
    }
  }

  return null
}

/** Parse Tavily MCP human-readable search output (Title/URL/Content blocks). */
export function parseTavilyMcpTextOutput(text: string): {
  query?: string
  count: number
  results: WebSearchResultItem[]
} {
  const trimmed = text.trim()
  if (!trimmed) {
    return { count: 0, results: [] }
  }

  const answerMatch = trimmed.match(/^Answer:\s*(.+)$/m)
  const query = answerMatch?.[1]?.trim()

  const detailedIndex = trimmed.indexOf('Detailed Results:')
  const resultsSection = detailedIndex >= 0 ? trimmed.slice(detailedIndex) : trimmed
  const chunks = resultsSection.split(/\nTitle:\s*/)

  const results: WebSearchResultItem[] = []

  for (const chunk of chunks) {
    if (!chunk.trim() || chunk.startsWith('Detailed Results:')) {
      continue
    }

    const titleLineEnd = chunk.indexOf('\n')
    const title = titleLineEnd >= 0 ? chunk.slice(0, titleLineEnd).trim() : chunk.trim()

    const urlMatch = chunk.match(/^URL:\s*(.+)$/m)
    const url = urlMatch?.[1]?.trim() ?? ''

    const contentMatch = chunk.match(
      /^Content:\s*([\s\S]*?)(?=\n(?:Favicon:|Raw Content:|Images:|\[\d+\]\s*URL:)|$)/m
    )
    const content = contentMatch?.[1]?.trim() ?? ''

    if (!title && !url && !content) {
      continue
    }

    results.push({
      title,
      url,
      snippet: content,
      content: content || undefined,
    })
  }

  return {
    query,
    count: results.length,
    results,
  }
}

function parseStructuredPayload(payload: ParsedWebSearchPayload): {
  query?: string
  count: number
  results: WebSearchResultItem[]
  error?: string
} {
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

export function parseWebSearchOutput(raw: unknown): {
  query?: string
  count: number
  results: WebSearchResultItem[]
  error?: string
} {
  if (raw == null) {
    return { count: 0, results: [] }
  }

  const textContent = unwrapMcpTextContent(raw)
  if (textContent != null) {
    const stripped = textContent.trim()
    if (stripped.startsWith('{') || stripped.startsWith('[')) {
      try {
        const parsedJson = JSON.parse(stripped) as unknown
        const structured = parseWebSearchOutput(parsedJson)
        if (structured.results.length > 0 || structured.error) {
          return structured
        }
      } catch {
        // Fall through to Tavily MCP text parser
      }
    }

    const tavilyParsed = parseTavilyMcpTextOutput(textContent)
    if (tavilyParsed.results.length > 0) {
      return tavilyParsed
    }

    if (!stripped.startsWith('{') && !stripped.startsWith('[')) {
      return { count: 0, results: [], error: stripped }
    }
  }

  if (typeof raw === 'object') {
    const payload = raw as ParsedWebSearchPayload
    if (Array.isArray(payload.results) || payload.error || payload.query || payload.count != null) {
      return parseStructuredPayload(payload)
    }
  }

  if (typeof raw === 'string') {
    try {
      return parseWebSearchOutput(JSON.parse(raw) as unknown)
    } catch {
      return parseTavilyMcpTextOutput(raw)
    }
  }

  return { count: 0, results: [] }
}
