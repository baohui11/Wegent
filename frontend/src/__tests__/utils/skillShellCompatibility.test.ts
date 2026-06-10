// SPDX-FileCopyrightText: 2026 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import {
  filterSkillsByShellType,
  isSkillCompatibleWithShell,
  resolveTeamShellType,
} from '@/utils/skillShellCompatibility'
import type { Team } from '@/types/api'

describe('skillShellCompatibility', () => {
  it('matches bindShells case-insensitively', () => {
    expect(isSkillCompatibleWithShell({ bindShells: ['Chat'] }, 'chat')).toBe(true)
    expect(isSkillCompatibleWithShell({ bindShells: ['ClaudeCode'] }, 'ClaudeCode')).toBe(true)
    expect(isSkillCompatibleWithShell({ bindShells: ['ClaudeCode'] }, 'Chat')).toBe(false)
  })

  it('allows skills without bindShells for backward compatibility', () => {
    expect(isSkillCompatibleWithShell({ bindShells: null }, 'Chat')).toBe(true)
    expect(isSkillCompatibleWithShell({ bindShells: [] }, 'ClaudeCode')).toBe(true)
    expect(isSkillCompatibleWithShell({}, 'Chat')).toBe(true)
  })

  it('filters explicit bindShells lists', () => {
    const skills = [
      { name: 'chat-only', bindShells: ['Chat'] },
      { name: 'code-only', bindShells: ['ClaudeCode'] },
      { name: 'both', bindShells: ['Chat', 'ClaudeCode'] },
    ]

    expect(filterSkillsByShellType(skills, 'Chat').map(skill => skill.name)).toEqual([
      'chat-only',
      'both',
    ])
    expect(filterSkillsByShellType(skills, 'ClaudeCode').map(skill => skill.name)).toEqual([
      'code-only',
      'both',
    ])
  })

  it('resolves team shell type from leader bot shell_type', () => {
    const team = {
      bots: [{ role: 'leader', bot: { shell_type: 'Chat' } }],
    } as Team

    expect(resolveTeamShellType(team)).toBe('Chat')
  })

  it('falls back to agent_type when shell_type is missing', () => {
    const team = {
      agent_type: 'claudecode',
      bots: [],
    } as Team

    expect(resolveTeamShellType(team)).toBe('ClaudeCode')
  })
})
