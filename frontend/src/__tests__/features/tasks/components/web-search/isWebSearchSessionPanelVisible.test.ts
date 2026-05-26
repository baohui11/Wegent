// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import {
  isWebSearchSessionPanelVisible,
  type WebSearchSession,
} from '@/features/tasks/components/web-search/types'

function makeSession(overrides: Partial<WebSearchSession> = {}): WebSearchSession {
  return {
    id: 'session-1',
    query: 'test query',
    status: 'done',
    results: [],
    count: 0,
    ...overrides,
  }
}

describe('isWebSearchSessionPanelVisible', () => {
  it('shows loading sessions in the panel', () => {
    expect(isWebSearchSessionPanelVisible(makeSession({ status: 'loading' }))).toBe(true)
  })

  it('hides error sessions from the panel', () => {
    expect(
      isWebSearchSessionPanelVisible(
        makeSession({ status: 'error', error: 'Search failed' })
      )
    ).toBe(false)
  })

  it('hides sessions with an error message even when status is done', () => {
    expect(
      isWebSearchSessionPanelVisible(
        makeSession({ status: 'done', error: 'No results' })
      )
    ).toBe(false)
  })

  it('hides successful sessions with no results', () => {
    expect(isWebSearchSessionPanelVisible(makeSession({ status: 'done', results: [] }))).toBe(
      false
    )
  })

  it('shows successful sessions with results', () => {
    expect(
      isWebSearchSessionPanelVisible(
        makeSession({
          status: 'done',
          count: 1,
          results: [{ title: 'Example', url: 'https://example.com', snippet: 'Snippet' }],
        })
      )
    ).toBe(true)
  })
})
