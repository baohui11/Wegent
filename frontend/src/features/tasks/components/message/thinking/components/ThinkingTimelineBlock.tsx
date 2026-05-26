// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import { memo } from 'react'
import ReasoningDisplay from '../ReasoningDisplay'

interface ThinkingTimelineBlockProps {
  content: string
  status?: string
}

/**
 * Inline thinking/reasoning block for the mixed content timeline.
 */
const ThinkingTimelineBlock = memo(function ThinkingTimelineBlock({
  content,
  status,
}: ThinkingTimelineBlockProps) {
  if (!content) {
    return null
  }

  return (
    <div data-testid="thinking-timeline-block">
      <ReasoningDisplay
        reasoningContent={content}
        isStreaming={status === 'streaming'}
      />
    </div>
  )
})

export default ThinkingTimelineBlock
