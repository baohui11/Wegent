// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

/** Claude Code MCP tool name: mcp__{server}__tavily_search */
const MCP_TAVILY_SEARCH_PATTERN = /^mcp__.+__tavily[_-]search$/i

export function isWebSearchToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase().replace(/-/g, '_')
  if (normalized === 'web_search' || normalized === 'websearch') {
    return true
  }
  if (normalized === 'tavily_search') {
    return true
  }
  return MCP_TAVILY_SEARCH_PATTERN.test(toolName)
}

export function getWebSearchQueryFromInput(
  input: Record<string, unknown> | string | undefined | null
): string {
  if (!input) return ''
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed.startsWith('{')) return trimmed
    try {
      return getWebSearchQueryFromInput(JSON.parse(trimmed) as Record<string, unknown>)
    } catch {
      return trimmed
    }
  }
  if (typeof input.query === 'string') return input.query
  if (typeof input.q === 'string') return input.q
  return ''
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function getFaviconUrl(url: string): string {
  const hostname = getHostname(url)
  if (!hostname) return ''
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`
}

export function getSiteDisplayName(url: string, siteName?: string): string {
  if (siteName?.trim()) return siteName.trim()
  return getHostname(url)
}

export function formatPublishedDate(value?: string): string | null {
  if (!value?.trim()) return null

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}
