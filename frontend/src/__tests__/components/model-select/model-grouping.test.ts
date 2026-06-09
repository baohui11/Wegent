// SPDX-FileCopyrightText: 2026 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { buildModelTreeGroups, matchesModelSearch } from '@/components/model-select/model-grouping'
import {
  resolveModelProviderLogoSlug,
  slugifyModelGroupName,
} from '@/components/model-select/model-provider-icon'
import type { GroupableModel } from '@/components/model-select/model-grouping'

const models: GroupableModel[] = [
  {
    name: 'model-a',
    displayName: 'Model A',
    provider: 'provider-one',
    modelId: 'model-a-id',
    modelGroup: 'Anthropic',
    modelSubGroup: 'Claude 3',
  },
  {
    name: 'model-b',
    displayName: 'Model B',
    provider: 'provider-two',
    modelId: 'model-b-id',
    modelGroup: 'Anthropic',
    modelSubGroup: 'Claude 4',
  },
  {
    name: 'model-c',
    displayName: 'Model C',
    provider: 'provider-three',
    modelId: 'model-c-id',
  },
]

describe('model grouping', () => {
  it('builds single-level tree groups from modelGroup', () => {
    const groups = buildModelTreeGroups(models, {
      ungroupedLabel: 'Ungrouped',
      uncategorizedLabel: 'Other',
    })

    expect(groups).toEqual([
      {
        name: 'Anthropic',
        count: 2,
        models: [models[0], models[1]],
      },
      {
        name: 'Ungrouped',
        count: 1,
        models: [models[2]],
      },
    ])
  })

  it('matches search against model group and subgroup text', () => {
    expect(matchesModelSearch(models[0], 'anthropic')).toBe(true)
    expect(matchesModelSearch(models[0], 'claude 3')).toBe(true)
    expect(matchesModelSearch(models[0], 'provider-one')).toBe(true)
    expect(matchesModelSearch(models[0], 'missing')).toBe(false)
  })

  it('slugifies group names for logo filenames', () => {
    expect(slugifyModelGroupName('ZhiPu AI')).toBe('zhipu-ai')
    expect(resolveModelProviderLogoSlug('Claude', null)).toBe('anthropic')
    expect(resolveModelProviderLogoSlug('OpenAI', null)).toBe('openai')
  })
})
