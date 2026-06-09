// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import {
  parseWebSearchOutput,
  parseTavilyMcpTextOutput,
} from '@/features/tasks/components/web-search/parseWebSearchOutput'

describe('parseWebSearchOutput', () => {
  it('parses JSON string payloads', () => {
    const parsed = parseWebSearchOutput(
      JSON.stringify({
        query: 'Wegent',
        count: 2,
        results: [
          {
            title: 'Result A',
            url: 'https://example.com/a',
            snippet: 'Snippet A',
          },
        ],
      })
    )

    expect(parsed.query).toBe('Wegent')
    expect(parsed.count).toBe(2)
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0]?.title).toBe('Result A')
  })

  it('returns error state when payload contains error', () => {
    const parsed = parseWebSearchOutput({ error: 'Search failed', query: 'test' })

    expect(parsed.error).toBe('Search failed')
    expect(parsed.results).toEqual([])
  })

  it('parses Tavily MCP formatted text output', () => {
    const text = [
      'Answer: quick summary',
      'Detailed Results:',
      '',
      'Title: Result A',
      'URL: https://example.com/a',
      'Content: Snippet A',
      '',
      'Title: Result B',
      'URL: https://example.com/b',
      'Content: Snippet B',
    ].join('\n')

    const parsed = parseTavilyMcpTextOutput(text)

    expect(parsed.query).toBe('quick summary')
    expect(parsed.count).toBe(2)
    expect(parsed.results[0]?.url).toBe('https://example.com/a')
    expect(parsed.results[1]?.snippet).toBe('Snippet B')
  })

  it('parses MCP content blocks through parseWebSearchOutput', () => {
    const parsed = parseWebSearchOutput([
      {
        type: 'text',
        text: [
          'Detailed Results:',
          '',
          'Title: MCP Result',
          'URL: https://example.com/mcp',
          'Content: From MCP',
        ].join('\n'),
      },
    ])

    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0]?.title).toBe('MCP Result')
  })
})
