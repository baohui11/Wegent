// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import React from 'react'
import type { WebSearchResultItem } from './types'
import {
  formatPublishedDate,
  getFaviconUrl,
  getSiteDisplayName,
} from './webSearchUtils'

interface WebSearchResultItemCardProps {
  result: WebSearchResultItem
}

export function WebSearchResultItemCard({ result }: WebSearchResultItemCardProps) {
  const siteName = getSiteDisplayName(result.url, result.siteName)
  const faviconUrl = result.url ? getFaviconUrl(result.url) : ''
  const publishedDate = formatPublishedDate(result.publishedDate)
  const snippet = result.snippet || result.content || ''

  const handleOpen = () => {
    if (!result.url) return
    window.open(result.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={!result.url}
      className="w-full text-left py-4 border-b border-border last:border-b-0 hover:bg-hover/60 transition-colors rounded-lg px-1 -mx-1 disabled:cursor-default"
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        {faviconUrl ? (
          <img
            src={faviconUrl}
            alt=""
            className="h-4 w-4 rounded-full flex-shrink-0 bg-surface"
            loading="lazy"
          />
        ) : (
          <div className="h-4 w-4 rounded-full bg-surface flex-shrink-0" />
        )}
        <span className="text-xs text-text-secondary truncate">{siteName}</span>
        {publishedDate && (
          <span className="text-xs text-text-muted flex-shrink-0">{publishedDate}</span>
        )}
      </div>

      {result.title && (
        <div className="text-sm font-semibold text-text-primary leading-5 mb-1.5 line-clamp-2">
          {result.title}
        </div>
      )}

      {snippet && (
        <p className="text-xs text-text-secondary leading-5 line-clamp-3">{snippet}</p>
      )}
    </button>
  )
}

export default WebSearchResultItemCard
