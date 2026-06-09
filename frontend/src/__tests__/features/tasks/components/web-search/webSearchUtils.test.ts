// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import {
  getWebSearchQueryFromInput,
  isWebSearchToolName,
} from '@/features/tasks/components/web-search/webSearchUtils'

describe('isWebSearchToolName', () => {
  it('matches Chat builtin web_search', () => {
    expect(isWebSearchToolName('web_search')).toBe(true)
    expect(isWebSearchToolName('WebSearch')).toBe(true)
  })

  it('matches Tavily MCP tool names', () => {
    expect(isWebSearchToolName('tavily_search')).toBe(true)
    expect(isWebSearchToolName('mcp__web-research-claude-code_tavily__tavily_search')).toBe(true)
    expect(isWebSearchToolName('mcp__联网搜索-Agent_tavily__tavily_search')).toBe(true)
  })

  it('does not match unrelated tools', () => {
    expect(isWebSearchToolName('tavily_extract')).toBe(false)
    expect(isWebSearchToolName('Read')).toBe(false)
  })
})

describe('getWebSearchQueryFromInput', () => {
  it('reads query from object and JSON string inputs', () => {
    expect(getWebSearchQueryFromInput({ query: 'hello' })).toBe('hello')
    expect(getWebSearchQueryFromInput(JSON.stringify({ query: 'world' }))).toBe('world')
  })
})
