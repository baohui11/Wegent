// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import {
  getCompatibleProviderFromAgentType,
  getClaudeCodeModelRuntimeFamily,
  isClaudeCodeModelRuntimeFamily,
  isModelCompatibleWithAgentType,
  isOpenAIResponsesModel,
  shouldLockClaudeCodeModelRuntimeFamily,
} from '@/utils/modelCompatibility'

describe('getCompatibleProviderFromAgentType', () => {
  describe('null-like inputs', () => {
    it('returns null for undefined', () => {
      const result = getCompatibleProviderFromAgentType(undefined)
      expect(result).toBeNull()
    })

    it('returns null for null', () => {
      const result = getCompatibleProviderFromAgentType(null)
      expect(result).toBeNull()
    })

    it('returns null for empty string', () => {
      const result = getCompatibleProviderFromAgentType('')
      expect(result).toBeNull()
    })
  })

  describe('agno mapping', () => {
    it('maps "agno" to "openai"', () => {
      const result = getCompatibleProviderFromAgentType('agno')
      expect(result).toEqual(['openai'])
    })

    it('maps "AGNO" to "openai" (case-insensitive)', () => {
      const result = getCompatibleProviderFromAgentType('AGNO')
      expect(result).toEqual(['openai'])
    })

    it('maps "Agno" to "openai" (mixed case)', () => {
      const result = getCompatibleProviderFromAgentType('Agno')
      expect(result).toEqual(['openai'])
    })
  })

  describe('claude mapping', () => {
    it('maps "claude" to ClaudeCode-compatible providers', () => {
      const result = getCompatibleProviderFromAgentType('claude')
      expect(result).toEqual(['claude', 'anthropic'])
    })

    it('maps "claudecode" to ClaudeCode-compatible providers', () => {
      const result = getCompatibleProviderFromAgentType('claudecode')
      expect(result).toEqual(['claude', 'anthropic'])
    })

    it('maps "ClaudeCode" to ClaudeCode-compatible providers (real-world casing)', () => {
      const result = getCompatibleProviderFromAgentType('ClaudeCode')
      expect(result).toEqual(['claude', 'anthropic'])
    })
  })

  describe('unknown inputs', () => {
    it('returns null for unknown agent type "dify"', () => {
      const result = getCompatibleProviderFromAgentType('dify')
      expect(result).toBeNull()
    })

    it('returns null for provider name "openai" (not a valid agent type)', () => {
      const result = getCompatibleProviderFromAgentType('openai')
      expect(result).toBeNull()
    })

    it('returns null for whitespace-padded "  agno  " (no trim)', () => {
      const result = getCompatibleProviderFromAgentType('  agno  ')
      expect(result).toBeNull()
    })
  })
})

describe('isOpenAIResponsesModel', () => {
  it('returns true when protocol is openai-responses', () => {
    expect(isOpenAIResponsesModel({ protocol: 'openai-responses' })).toBe(true)
  })

  it('returns false for OpenAI Chat Completions protocol', () => {
    expect(isOpenAIResponsesModel({ protocol: 'openai' })).toBe(false)
  })

  it('returns false when protocol is missing', () => {
    expect(isOpenAIResponsesModel({})).toBe(false)
  })
})

describe('isModelCompatibleWithAgentType', () => {
  it('allows CodeX-compatible OpenAI models for ClaudeCode teams', () => {
    expect(
      isModelCompatibleWithAgentType(
        { provider: 'openai', config: { protocol: 'openai-responses' } },
        'ClaudeCode'
      )
    ).toBe(true)
  })

  it('rejects non-CodeX OpenAI models for ClaudeCode teams', () => {
    expect(isModelCompatibleWithAgentType({ provider: 'openai', config: {} }, 'claude')).toBe(false)
  })

  it('allows anthropic models for ClaudeCode teams', () => {
    expect(isModelCompatibleWithAgentType({ provider: 'anthropic' }, 'claudecode')).toBe(true)
  })
})

describe('ClaudeCode runtime family helpers', () => {
  it('classifies anthropic models as claude runtime', () => {
    expect(getClaudeCodeModelRuntimeFamily({ provider: 'anthropic' })).toBe('claude')
  })

  it('classifies openai-responses models as openai-responses runtime', () => {
    expect(
      getClaudeCodeModelRuntimeFamily({
        provider: 'openai',
        config: { protocol: 'openai-responses' },
      })
    ).toBe('openai-responses')
  })

  it('locks runtime family only after messages for ClaudeCode teams', () => {
    expect(shouldLockClaudeCodeModelRuntimeFamily('ClaudeCode', false)).toBe(false)
    expect(shouldLockClaudeCodeModelRuntimeFamily('ClaudeCode', true)).toBe(true)
    expect(shouldLockClaudeCodeModelRuntimeFamily('chat', true)).toBe(false)
  })

  it('matches models within the same runtime family', () => {
    expect(isClaudeCodeModelRuntimeFamily({ provider: 'claude' }, 'claude')).toBe(true)
    expect(
      isClaudeCodeModelRuntimeFamily(
        { provider: 'openai', config: { protocol: 'openai-responses' } },
        'claude'
      )
    ).toBe(false)
  })
})
