// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Provider identifier used to filter LLM models compatible with a given
 * agent runtime. Drives the model dropdown in task/subscription editors.
 */
export type CompatibleProvider = 'openai' | 'claude' | 'anthropic'

export interface ModelAgentCompatibilityInput {
  provider: string
  config?: Record<string, unknown> | null
}

/** Whether an OpenAI model uses the Responses API (defined as protocol at model creation). */
export function isOpenAIResponsesModel(config?: Record<string, unknown> | null): boolean {
  return String(config?.protocol ?? '').toLowerCase() === 'openai-responses'
}

/** ClaudeCode executor runtime family used to lock model switching within a task. */
export type ClaudeCodeModelRuntimeFamily = 'claude' | 'openai-responses'

export function getClaudeCodeModelRuntimeFamily(
  model: ModelAgentCompatibilityInput | null | undefined
): ClaudeCodeModelRuntimeFamily | null {
  if (!model) return null

  const provider = model.provider?.toLowerCase()
  if (provider === 'claude' || provider === 'anthropic') {
    return 'claude'
  }
  if (provider === 'openai' && isOpenAIResponsesModel(model.config)) {
    return 'openai-responses'
  }
  return null
}

export function isClaudeCodeModelRuntimeFamily(
  model: ModelAgentCompatibilityInput,
  family: ClaudeCodeModelRuntimeFamily
): boolean {
  return getClaudeCodeModelRuntimeFamily(model) === family
}

export function shouldLockClaudeCodeModelRuntimeFamily(
  agentType: string | null | undefined,
  hasMessages: boolean
): boolean {
  if (!hasMessages) return false
  const normalized = agentType?.toLowerCase()
  return normalized === 'claude' || normalized === 'claudecode'
}

/**
 * Resolve which model provider is compatible with a given agent type.
 *
 * Mapping (case-insensitive):
 * - `'agno'`                       → `['openai']`
 * - `'claude'` / `'claudecode'`    → `['claude', 'anthropic']` (OpenAI via CodeX handled separately)
 * - any other non-empty string     → `null`
 * - `null` / `undefined` / `''`    → `null`
 *
 * @param agentType - The agent's `agent_type` field, typically from a Team
 * @returns Compatible provider identifiers, or `null` if no mapping applies
 *
 * @example
 * getCompatibleProviderFromAgentType('Agno')        // ['openai']
 * getCompatibleProviderFromAgentType('ClaudeCode')  // ['claude', 'anthropic']
 * getCompatibleProviderFromAgentType('dify')        // null
 * getCompatibleProviderFromAgentType(null)          // null
 */
export function getCompatibleProviderFromAgentType(
  agentType?: string | null
): CompatibleProvider[] | null {
  if (!agentType) return null
  const normalized = agentType.toLowerCase()
  if (normalized === 'agno') return ['openai']
  if (normalized === 'claude' || normalized === 'claudecode') {
    return ['claude', 'anthropic']
  }
  return null
}

/**
 * Check whether a model is compatible with the given agent runtime.
 *
 * ClaudeCode also supports OpenAI Responses API models, which run through CodeX CLI
 * inside the executor container.
 */
export function isModelCompatibleWithAgentType(
  model: ModelAgentCompatibilityInput,
  agentType?: string | null
): boolean {
  if (!agentType) return true

  const normalized = agentType.toLowerCase()
  const provider = model.provider?.toLowerCase()

  if (normalized === 'agno') {
    return provider === 'openai'
  }

  if (normalized === 'claude' || normalized === 'claudecode') {
    if (provider === 'claude' || provider === 'anthropic') return true
    // OpenAI Chat Completions (protocol=openai) is not supported; Responses API runs via CodeX CLI
    if (provider === 'openai') return isOpenAIResponsesModel(model.config)
    return false
  }

  return true
}
