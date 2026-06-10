// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import type { UnifiedSkill } from '@/apis/skills'
import type { Team } from '@/types/api'

export interface SkillShellBindingFields {
  bindShells?: string[] | null
}

export interface ShellIdentityFields {
  shellType?: string | null
  name?: string | null
}

/**
 * Resolve shell type string used for bindShells matching.
 * Prefers shellType over shell resource name.
 */
export function resolveShellTypeFromShell(
  shell: ShellIdentityFields | null | undefined
): string | null {
  if (!shell) return null
  const shellType = shell.shellType?.trim()
  if (shellType) return shellType
  const name = shell.name?.trim()
  return name || null
}

/**
 * Resolve the active shell type for a team (leader bot).
 */
export function resolveTeamShellType(team: Team | null | undefined): string | null {
  if (!team) return null

  const leaderBot = team.bots?.find(bot => bot.role === 'leader') ?? team.bots?.[0]
  const shellType = leaderBot?.bot?.shell_type?.trim()
  if (shellType) return shellType

  const agentType = team.agent_type?.toLowerCase()
  if (agentType === 'chat') return 'Chat'
  if (agentType === 'dify') return 'Dify'
  if (agentType === 'agno') return 'Agno'
  if (agentType === 'claude' || agentType === 'claudecode') return 'ClaudeCode'

  return null
}

/**
 * Whether a skill is compatible with the given shell type.
 *
 * Matches backend wizard behavior: only restrict when bindShells is non-empty.
 * Comparison is case-insensitive.
 */
export function isSkillCompatibleWithShell(
  skill: SkillShellBindingFields | null | undefined,
  shellType: string | null | undefined
): boolean {
  if (!skill) return false
  if (!shellType?.trim()) return true

  const bindShells = skill.bindShells
  if (!bindShells || bindShells.length === 0) {
    return true
  }

  const normalizedShell = shellType.trim().toLowerCase()
  return bindShells.some(shell => shell.trim().toLowerCase() === normalizedShell)
}

export function filterSkillsByShellType<T extends SkillShellBindingFields>(
  skills: T[],
  shellType: string | null | undefined
): T[] {
  if (!shellType?.trim()) return skills
  return skills.filter(skill => isSkillCompatibleWithShell(skill, shellType))
}

export function filterUnifiedSkillsForTeam(
  skills: UnifiedSkill[],
  team: Team | null | undefined
): UnifiedSkill[] {
  return filterSkillsByShellType(skills, resolveTeamShellType(team))
}
