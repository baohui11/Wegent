// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { extractWebSearchSessions } from '@/features/tasks/components/web-search/extractWebSearchSessions'
import type { UnifiedMessage } from '@/features/tasks/state'

describe('extractWebSearchSessions', () => {
  it('extracts sessions from Tavily MCP tool blocks', () => {
    const messages = new Map<string, UnifiedMessage>([
      [
        '1',
        {
          messageId: 1,
          timestamp: 1,
          result: {
            blocks: [
              {
                id: 'tool-1',
                type: 'tool',
                tool_use_id: 'tool-1',
                tool_name: 'mcp__web-research-agent_tavily__tavily_search',
                tool_input: { query: 'Wegent MCP' },
                tool_output: JSON.stringify({
                  query: 'Wegent MCP',
                  count: 1,
                  results: [
                    {
                      title: 'Result A',
                      url: 'https://example.com/a',
                      snippet: 'Snippet A',
                    },
                  ],
                }),
                status: 'done',
                timestamp: 1000,
              },
            ],
          },
        } as UnifiedMessage,
      ],
    ])

    const sessions = extractWebSearchSessions(messages)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.query).toBe('Wegent MCP')
    expect(sessions[0]?.results[0]?.url).toBe('https://example.com/a')
  })
})
