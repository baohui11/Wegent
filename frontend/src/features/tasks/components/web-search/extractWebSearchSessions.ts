// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import type { UnifiedMessage } from '@/features/tasks/state'
import type { MessageBlock } from '@/features/tasks/components/message/thinking/types'
import type { WebSearchSession, WebSearchSessionStatus } from './types'
import { parseWebSearchOutput } from './parseWebSearchOutput'
import { isWebSearchToolName } from './webSearchUtils'

function mapBlockStatus(status: MessageBlock['status']): WebSearchSessionStatus {
  if (status === 'error' || status === 'failed') return 'error'
  if (
    status === 'generating_arguments' ||
    status === 'pending' ||
    status === 'streaming' ||
    status === 'queued' ||
    status === 'sending'
  ) {
    return 'loading'
  }
  if (!status || status === 'done' || status === 'applied' || status === 'expired') return 'done'
  return 'loading'
}

function sessionFromToolBlock(block: MessageBlock): WebSearchSession | null {
  if (block.type !== 'tool') return null

  const toolName = block.tool_name ?? ''
  if (!isWebSearchToolName(toolName)) return null

  const query =
    typeof block.tool_input?.query === 'string'
      ? block.tool_input.query
      : typeof block.tool_input?.q === 'string'
        ? block.tool_input.q
        : ''

  const status = mapBlockStatus(block.status)
  const parsed =
    block.tool_output != null
      ? parseWebSearchOutput(block.tool_output)
      : { count: 0, results: [] as WebSearchSession['results'] }

  const hasOutput = block.tool_output != null
  const resolvedStatus: WebSearchSessionStatus =
    status === 'loading' && hasOutput && !parsed.error ? 'done' : status

  return {
    id: block.tool_use_id || block.id,
    query: parsed.query || query,
    status: parsed.error ? 'error' : resolvedStatus,
    results: parsed.results,
    count: parsed.count,
    error: parsed.error,
    timestamp: block.timestamp,
  }
}

export function extractWebSearchSessions(
  messages: Map<string, UnifiedMessage> | undefined
): WebSearchSession[] {
  if (!messages || messages.size === 0) return []

  const sessions: WebSearchSession[] = []
  const sortedMessages = Array.from(messages.values()).sort((a, b) => {
    const aKey = a.messageId ?? a.timestamp
    const bKey = b.messageId ?? b.timestamp
    return aKey - bKey
  })

  for (const message of sortedMessages) {
    const blocks = message.result?.blocks
    if (!blocks?.length) continue

    for (const block of blocks) {
      const session = sessionFromToolBlock(block)
      if (session) {
        sessions.push(session)
      }
    }
  }

  return sessions
}
