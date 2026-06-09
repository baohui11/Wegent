// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Check, ChevronDown, ChevronRight, Search, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { paths } from '@/config/paths'
import { Tag } from '@/components/ui/tag'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import {
  buildModelTreeGroups,
  getModelDisplayName,
  matchesModelSearch,
} from '@/components/model-select/model-grouping'
import {
  ModelProviderIcon,
  SelectedModelProviderIcon,
} from '@/components/model-select/model-provider-icon'
import { useModelSelection } from '@/features/tasks/hooks/useModelSelection'
import type { Team } from '@/types/api'
import type { Model } from '@/features/tasks/hooks/useModelSelection'
import { DEFAULT_MODEL_NAME } from '@/features/tasks/hooks/useModelSelection'

function getModelKey(model: Model): string {
  return `${model.name}:${model.type || ''}`
}

function getGroupName(model: Model, fallback: string): string {
  return model.modelGroup?.trim() || fallback
}

function getSubGroupLabel(model: Model, fallback: string): string | null {
  const subGroup = model.modelSubGroup?.trim()
  if (!subGroup || subGroup === fallback) return null
  return subGroup
}

interface MobileModelSelectorProps {
  selectedModel: Model | null
  setSelectedModel: (model: Model | null) => void
  forceOverride?: boolean
  setForceOverride?: (force: boolean) => void
  selectedTeam: Team | null
  disabled: boolean
  isLoading?: boolean
  teamId?: number | null
  taskId?: number | null
  taskModelId?: string | null
}

export default function MobileModelSelector({
  selectedModel: externalSelectedModel,
  setSelectedModel: externalSetSelectedModel,
  forceOverride: externalForceOverride = false,
  setForceOverride: externalSetForceOverride = () => {},
  selectedTeam,
  disabled,
  isLoading: externalLoading,
  teamId,
  taskId,
  taskModelId,
}: MobileModelSelectorProps) {
  const { t } = useTranslation()
  const router = useRouter()

  const modelSelection = useModelSelection({
    teamId: teamId ?? null,
    taskId: taskId ?? null,
    taskModelId,
    selectedTeam,
    disabled,
  })

  useEffect(() => {
    if (modelSelection.selectedModel !== externalSelectedModel) {
      if (modelSelection.selectedModel) {
        externalSetSelectedModel(modelSelection.selectedModel)
      }
    }
  }, [modelSelection.selectedModel, externalSelectedModel, externalSetSelectedModel])

  useEffect(() => {
    if (modelSelection.forceOverride !== externalForceOverride) {
      externalSetForceOverride(modelSelection.forceOverride)
    }
  }, [modelSelection.forceOverride, externalForceOverride, externalSetForceOverride])

  const [isOpen, setIsOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!isOpen) {
      setSearchValue('')
      setIsSearchFocused(false)
    }
  }, [isOpen])

  const isDisabled =
    disabled || externalLoading || modelSelection.isLoading || modelSelection.isMixedTeam

  const handleModelSelect = (model: Model) => {
    modelSelection.selectModel(model)
    setIsOpen(false)
  }

  const groupLabels = useMemo(
    () => ({
      ungrouped: t('common:models.ungrouped', 'Ungrouped'),
      uncategorized: t('common:models.uncategorized', 'Uncategorized'),
    }),
    [t]
  )

  const treeGroups = useMemo(
    () =>
      buildModelTreeGroups(modelSelection.filteredModels, {
        ungroupedLabel: groupLabels.ungrouped,
        uncategorizedLabel: groupLabels.uncategorized,
      }),
    [groupLabels.uncategorized, groupLabels.ungrouped, modelSelection.filteredModels]
  )

  const selectedGroupName =
    modelSelection.selectedModel && modelSelection.selectedModel.name !== DEFAULT_MODEL_NAME
      ? getGroupName(modelSelection.selectedModel, groupLabels.ungrouped)
      : ''

  useEffect(() => {
    if (!isOpen || treeGroups.length === 0) return

    setExpandedGroups(current => {
      const next = { ...current }
      let changed = false

      for (const group of treeGroups) {
        if (next[group.name] === undefined) {
          const shouldExpand =
            group.name === selectedGroupName ||
            (selectedGroupName === groupLabels.ungrouped && group === treeGroups[0])
          next[group.name] = shouldExpand
          changed = true
        }
      }

      if (selectedGroupName && !next[selectedGroupName]) {
        next[selectedGroupName] = true
        changed = true
      }

      return changed ? next : current
    })
  }, [isOpen, selectedGroupName, treeGroups])

  const normalizedSearchValue = searchValue.trim()
  const isSearching = normalizedSearchValue.length > 0
  const searchResults = modelSelection.filteredModels.filter(model =>
    matchesModelSearch(model, normalizedSearchValue)
  )

  const showDefaultInSearch =
    modelSelection.showDefaultOption &&
    (!normalizedSearchValue ||
      t('common:task_submit.default_model', '默认')
        .toLowerCase()
        .includes(normalizedSearchValue.toLowerCase()) ||
      t('common:task_submit.use_bot_model', '使用 Bot 预设模型')
        .toLowerCase()
        .includes(normalizedSearchValue.toLowerCase()))

  const renderDefaultRow = (withBorder = true) => (
    <button
      type="button"
      data-testid="mobile-model-default-option"
      onClick={() => {
        modelSelection.selectDefaultModel()
        setIsOpen(false)
      }}
      className={cn(
        'flex min-h-[44px] w-full items-center justify-between px-4 py-3 text-left',
        'active:bg-[#d1d1d6] dark:active:bg-[#3a3a3c]',
        withBorder && 'border-b border-[#c6c6c8] dark:border-[#38383a]'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] text-text-primary">
          {t('common:task_submit.default_model', '默认')}
        </div>
        <div className="mt-0.5 truncate text-[13px] text-[#8e8e93]">
          {t('common:task_submit.use_bot_model', '使用 Bot 预设模型')}
        </div>
      </div>
      {modelSelection.selectedModel?.name === DEFAULT_MODEL_NAME && (
        <Check className="ml-3 h-5 w-5 flex-shrink-0 text-[#007aff]" />
      )}
    </button>
  )

  const renderModelRow = (model: Model, showPath: boolean, withBorder = true) => {
    const isSelected =
      modelSelection.selectedModel?.name === model.name &&
      modelSelection.selectedModel?.type === model.type
    const groupName = getGroupName(model, groupLabels.ungrouped)
    const subGroupLabel = getSubGroupLabel(model, groupLabels.uncategorized)

    return (
      <button
        key={getModelKey(model)}
        type="button"
        data-testid={`mobile-model-option-${model.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
        onClick={() => handleModelSelect(model)}
        className={cn(
          'flex min-h-[44px] w-full items-center justify-between px-4 py-3 text-left',
          'active:bg-[#d1d1d6] dark:active:bg-[#3a3a3c]',
          withBorder && 'border-b border-[#c6c6c8] dark:border-[#38383a]'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ModelProviderIcon
              groupName={groupName}
              provider={model.provider}
              className="h-4 w-4"
            />
            <span className="truncate text-[15px] text-text-primary">
              {getModelDisplayName(model)}
            </span>
            {model.type === 'user' && (
              <Tag variant="info" className="flex-shrink-0 whitespace-nowrap text-[10px]">
                {t('common:settings.personal', '个人')}
              </Tag>
            )}
          </div>
          {showPath ? (
            <div className="mt-0.5 truncate pl-6 text-[13px] text-[#8e8e93]">{groupName}</div>
          ) : (
            subGroupLabel && (
              <div className="mt-0.5 truncate pl-6 text-[13px] text-[#8e8e93]">{subGroupLabel}</div>
            )
          )}
        </div>
        {isSelected && <Check className="ml-3 h-5 w-5 flex-shrink-0 text-[#007aff]" />}
      </button>
    )
  }

  const renderTreeGroups = () => (
    <div className="overflow-hidden rounded-xl bg-white dark:bg-[#2c2c2e]">
      {modelSelection.showDefaultOption && renderDefaultRow(treeGroups.length > 0)}
      {treeGroups.map((group, groupIndex) => {
        const isExpanded = expandedGroups[group.name] ?? false
        const isLastGroup = groupIndex === treeGroups.length - 1

        return (
          <Collapsible
            key={group.name}
            open={isExpanded}
            onOpenChange={open =>
              setExpandedGroups(current => ({ ...current, [group.name]: open }))
            }
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                data-testid={`mobile-model-tree-group-${group.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                className={cn(
                  'flex min-h-[44px] w-full items-center gap-2 px-4 py-3 text-left',
                  'active:bg-[#d1d1d6] dark:active:bg-[#3a3a3c]',
                  !isLastGroup && !isExpanded && 'border-b border-[#c6c6c8] dark:border-[#38383a]'
                )}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-[#8e8e93]" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#8e8e93]" />
                )}
                <ModelProviderIcon groupName={group.name} className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">
                  {group.name}
                </span>
                <span className="text-[13px] text-[#8e8e93]">{group.count}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {group.models.map((model, index) =>
                renderModelRow(model, false, !(isLastGroup && index === group.models.length - 1))
              )}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )

  const renderSearchResults = () => (
    <div className="overflow-hidden rounded-xl bg-white dark:bg-[#2c2c2e]">
      {showDefaultInSearch && renderDefaultRow(searchResults.length > 0)}
      {searchResults.map((model, index) =>
        renderModelRow(model, true, index !== searchResults.length - 1)
      )}
    </div>
  )

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          disabled={isDisabled}
          className={cn(
            'flex w-full items-center gap-1.5 min-w-0 max-w-full rounded-full px-3 py-2 h-9',
            'border transition-colors overflow-hidden',
            modelSelection.isModelRequired
              ? 'border-error text-error bg-error/5'
              : 'border-border bg-base text-text-primary',
            modelSelection.isLoading || externalLoading ? 'animate-pulse' : '',
            'focus:outline-none focus:ring-0',
            'active:opacity-70',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <SelectedModelProviderIcon
            model={modelSelection.selectedModel}
            fallbackModel={modelSelection.boundDefaultModel}
            defaultModelKey={DEFAULT_MODEL_NAME}
            className="h-4 w-4 flex-shrink-0"
          />
          <span className="flex-1 truncate text-xs min-w-0">{modelSelection.getDisplayText()}</span>
        </button>
      </DrawerTrigger>

      <DrawerContent className="max-h-[85vh] bg-[#f2f2f7] dark:bg-[#1c1c1e]" showHandle={false}>
        <div className="flex justify-center pt-2 pb-3">
          <div className="w-9 h-1 rounded-full bg-[#3c3c43]/30 dark:bg-[#5c5c5e]" />
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8e8e93]" />
            <input
              type="text"
              data-testid="mobile-model-search-input"
              placeholder={t('common:models.search_models', 'Search models or groups...')}
              value={searchValue}
              onChange={e => setSearchValue(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              className={cn(
                'w-full h-9 pl-9 pr-3 rounded-lg',
                'bg-[#e5e5ea] dark:bg-[#2c2c2e]',
                'text-sm text-text-primary placeholder:text-[#8e8e93]',
                'border-0 outline-none focus:ring-0'
              )}
            />
          </div>
        </div>

        <div
          className={cn(
            'flex-1 overflow-y-auto px-4 pb-4',
            isSearchFocused ? 'max-h-[70vh]' : 'max-h-[50vh]'
          )}
        >
          {modelSelection.error ? (
            <div className="rounded-xl bg-white dark:bg-[#2c2c2e] p-4 text-center text-sm text-error">
              {modelSelection.error}
            </div>
          ) : modelSelection.isLoading ? (
            <div className="rounded-xl bg-white dark:bg-[#2c2c2e] p-4 text-center text-sm text-[#8e8e93]">
              {t('common:loading', '加载中...')}
            </div>
          ) : isSearching && searchResults.length === 0 && !showDefaultInSearch ? (
            <div className="rounded-xl bg-white dark:bg-[#2c2c2e] p-4 text-center text-sm text-[#8e8e93]">
              {t('common:models.no_match', 'No matching models')}
            </div>
          ) : !isSearching && treeGroups.length === 0 && !modelSelection.showDefaultOption ? (
            <div className="rounded-xl bg-white dark:bg-[#2c2c2e] p-4 text-center text-sm text-[#8e8e93]">
              {t('common:models.no_models', '暂无模型')}
            </div>
          ) : isSearching ? (
            renderSearchResults()
          ) : (
            renderTreeGroups()
          )}
        </div>

        {!isSearchFocused && (
          <div className="px-4 pb-4 pt-2">
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  router.push(paths.settings.models.getHref())
                }}
                className="flex items-center gap-1.5 text-[#007aff] active:opacity-70"
              >
                <Settings className="h-4 w-4" />
                <span className="text-[13px]">{t('common:models.manage', '设置')}</span>
              </button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}
