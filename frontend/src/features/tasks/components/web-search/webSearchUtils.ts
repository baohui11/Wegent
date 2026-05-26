// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

export function isWebSearchToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase().replace(/-/g, '_')
  return normalized === 'web_search' || normalized === 'websearch'
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
