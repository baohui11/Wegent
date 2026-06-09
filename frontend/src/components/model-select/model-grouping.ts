// SPDX-FileCopyrightText: 2026 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

export interface GroupableModel {
  name: string
  displayName?: string | null
  provider?: string | null
  modelId?: string | null
  type?: string | null
  namespace?: string | null
  modelGroup?: string | null
  modelSubGroup?: string | null
}

export interface ModelTreeGroup<T extends GroupableModel = GroupableModel> {
  name: string
  count: number
  models: T[]
}

/** @deprecated Use ModelTreeGroup — kept for transitional imports */
export type ModelCascadeGroup<T extends GroupableModel = GroupableModel> = ModelTreeGroup<T>

interface GroupingLabels {
  ungroupedLabel: string
  uncategorizedLabel: string
}

function normalizeGroupValue(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function compareGroupName(a: string, b: string, fallback: string): number {
  if (a === fallback && b !== fallback) return 1
  if (b === fallback && a !== fallback) return -1
  return a.localeCompare(b)
}

export function getModelDisplayName(model: GroupableModel): string {
  return model.displayName?.trim() || model.name
}

export function getModelSearchText(model: GroupableModel): string {
  return [
    model.name,
    model.displayName,
    model.provider,
    model.modelId,
    model.type,
    model.namespace,
    model.modelGroup,
    model.modelSubGroup,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function matchesModelSearch(model: GroupableModel, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  return getModelSearchText(model).includes(normalizedQuery)
}

export function buildModelTreeGroups<T extends GroupableModel>(
  models: T[],
  labels: GroupingLabels
): ModelTreeGroup<T>[] {
  const groups = new Map<string, T[]>()

  for (const model of models) {
    const groupName = normalizeGroupValue(model.modelGroup, labels.ungroupedLabel)
    const groupModels = groups.get(groupName) ?? []
    groupModels.push(model)
    groups.set(groupName, groupModels)
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => compareGroupName(a, b, labels.ungroupedLabel))
    .map(([name, groupModels]) => {
      const sortedModels = groupModels.slice().sort((a, b) => {
        return getModelDisplayName(a).localeCompare(getModelDisplayName(b))
      })

      return {
        name,
        count: sortedModels.length,
        models: sortedModels,
      }
    })
}

/** @deprecated Use buildModelTreeGroups */
export function buildModelCascadeGroups<T extends GroupableModel>(
  models: T[],
  labels: GroupingLabels
): ModelTreeGroup<T>[] {
  return buildModelTreeGroups(models, labels)
}
