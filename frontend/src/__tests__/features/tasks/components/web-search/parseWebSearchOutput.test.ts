// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { parseWebSearchOutput } from '@/features/tasks/components/web-search/parseWebSearchOutput'

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
})
