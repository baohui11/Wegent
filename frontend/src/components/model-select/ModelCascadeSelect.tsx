// SPDX-FileCopyrightText: 2026 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  buildModelTreeGroups,
  getModelDisplayName,
  matchesModelSearch,
  type GroupableModel,
} from './model-grouping'
import { ModelProviderIcon, SelectedModelProviderIcon } from './model-provider-icon'

export interface ModelCascadeLabels {
  ungrouped: string
  uncategorized: string
  searchPlaceholder: string
  searchResults: string
  noModels: string
  noMatch: string
}

export interface SpecialModelOption {
  key: string
  label: string
  description?: string
  searchText?: string
}

interface ModelCascadeContentProps<T extends GroupableModel> {
  models: T[]
  selectedModel?: T | null
  selectedSpecialKey?: string | null
  specialOptions?: SpecialModelOption[]
  labels: ModelCascadeLabels
  searchValue: string
  onSearchValueChange: (value: string) => void
  onSelectModel: (model: T) => void
  onSelectSpecialOption?: (key: string) => void
  getModelKey?: (model: T) => string
  renderModelBadges?: (model: T) => React.ReactNode
  renderModelMeta?: (model: T) => React.ReactNode
  footer?: React.ReactNode
  className?: string
}

interface GroupedModelSelectProps<T extends GroupableModel> extends Omit<
  ModelCascadeContentProps<T>,
  'searchValue' | 'onSearchValueChange'
> {
  placeholder: string
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
  dataTestId?: string
  align?: 'start' | 'center' | 'end'
}

function defaultModelKey(model: GroupableModel): string {
  return `${model.name}:${model.type || ''}`
}

function sanitizeTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function getSpecialOptionSearchText(option: SpecialModelOption): string {
  return [option.key, option.label, option.description, option.searchText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function getModelGroupName(
  model: GroupableModel | null | undefined,
  labels: ModelCascadeLabels
): string {
  return model?.modelGroup?.trim() || labels.ungrouped
}

function getModelSubGroupLabel(model: GroupableModel, labels: ModelCascadeLabels): string | null {
  const subGroup = model.modelSubGroup?.trim()
  if (!subGroup || subGroup === labels.uncategorized) return null
  return subGroup
}

export function ModelCascadeContent<T extends GroupableModel>({
  models,
  selectedModel,
  selectedSpecialKey,
  specialOptions = [],
  labels,
  searchValue,
  onSearchValueChange,
  onSelectModel,
  onSelectSpecialOption,
  getModelKey = defaultModelKey,
  renderModelBadges,
  renderModelMeta,
  footer,
  className,
}: ModelCascadeContentProps<T>) {
  const groups = useMemo(
    () =>
      buildModelTreeGroups(models, {
        ungroupedLabel: labels.ungrouped,
        uncategorizedLabel: labels.uncategorized,
      }),
    [models, labels.uncategorized, labels.ungrouped]
  )

  const selectedGroupName = getModelGroupName(selectedModel, labels)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (groups.length === 0) {
      setExpandedGroups({})
      return
    }

    setExpandedGroups(current => {
      const next = { ...current }
      let changed = false

      for (const group of groups) {
        if (next[group.name] === undefined) {
          const shouldExpand =
            group.name === selectedGroupName ||
            (selectedGroupName === labels.ungrouped && group === groups[0])
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
  }, [groups, selectedGroupName])

  const normalizedSearchValue = searchValue.trim()
  const isSearching = normalizedSearchValue.length > 0
  const searchResults = useMemo(
    () => models.filter(model => matchesModelSearch(model, normalizedSearchValue)),
    [models, normalizedSearchValue]
  )
  const specialSearchResults = useMemo(() => {
    if (!normalizedSearchValue) return specialOptions
    const query = normalizedSearchValue.toLowerCase()
    return specialOptions.filter(option => getSpecialOptionSearchText(option).includes(query))
  }, [normalizedSearchValue, specialOptions])

  const toggleGroup = (groupName: string, open: boolean) => {
    setExpandedGroups(current => ({ ...current, [groupName]: open }))
  }

  const renderSpecialOption = (option: SpecialModelOption) => {
    const isSelected = selectedSpecialKey === option.key

    return (
      <button
        key={option.key}
        type="button"
        data-testid={`model-special-option-${sanitizeTestId(option.key)}`}
        onClick={() => onSelectSpecialOption?.(option.key)}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left',
          'hover:bg-hover focus:bg-hover focus:outline-none',
          isSelected && 'bg-primary/10 text-primary'
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text-primary">
            {option.label}
          </span>
          {option.description && (
            <span className="block truncate text-xs text-text-muted">{option.description}</span>
          )}
        </span>
        <Check className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
      </button>
    )
  }

  const renderModelOption = (model: T, showGroupPath: boolean) => {
    const modelKey = getModelKey(model)
    const selectedModelKey = selectedModel ? getModelKey(selectedModel) : null
    const isSelected = selectedModelKey === modelKey
    const groupName = getModelGroupName(model, labels)
    const subGroupLabel = getModelSubGroupLabel(model, labels)

    return (
      <button
        key={modelKey}
        type="button"
        data-model-key={modelKey}
        data-testid={`model-option-${sanitizeTestId(model.name)}`}
        onClick={() => onSelectModel(model)}
        className={cn(
          'flex w-full items-start justify-between gap-3 py-2 pl-9 pr-3 text-left',
          'hover:bg-hover focus:bg-hover focus:outline-none',
          isSelected && 'bg-primary/10 text-primary'
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <ModelProviderIcon
              groupName={groupName}
              provider={model.provider}
              className="h-4 w-4"
            />
            <span
              className="truncate text-sm font-medium text-text-primary"
              title={getModelDisplayName(model)}
            >
              {getModelDisplayName(model)}
            </span>
            {renderModelBadges?.(model)}
          </span>
          {showGroupPath && (
            <span className="block truncate pl-5 text-xs text-text-muted">{groupName}</span>
          )}
          {!showGroupPath && subGroupLabel && (
            <span className="block truncate pl-5 text-xs text-text-muted">{subGroupLabel}</span>
          )}
          {renderModelMeta?.(model)}
        </span>
        <Check
          className={cn('mt-0.5 h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
        />
      </button>
    )
  }

  return (
    <div
      className={cn(
        'flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden bg-base',
        className
      )}
    >
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={searchValue}
            onChange={event => onSearchValueChange(event.target.value)}
            placeholder={labels.searchPlaceholder}
            data-testid="model-cascade-search-input"
            className="h-9 bg-surface pl-9"
          />
        </div>
      </div>

      {models.length === 0 && specialOptions.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-text-muted">{labels.noModels}</div>
      ) : isSearching ? (
        <ScrollArea
          data-testid="model-cascade-search-results"
          className="h-[clamp(120px,calc(var(--radix-popover-content-available-height,520px)-112px),360px)] min-h-0"
        >
          <div className="px-2 py-2">
            <div className="px-2 pb-1 text-xs font-medium text-text-muted">
              {labels.searchResults}
            </div>
            {specialSearchResults.map(renderSpecialOption)}
            {searchResults.map(model => renderModelOption(model, true))}
            {specialSearchResults.length === 0 && searchResults.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-text-muted">{labels.noMatch}</div>
            )}
          </div>
        </ScrollArea>
      ) : (
        <ScrollArea
          data-testid="model-cascade-tree"
          className="h-[clamp(120px,calc(var(--radix-popover-content-available-height,520px)-112px),360px)] min-h-0"
        >
          <div className="px-2 py-2">
            {specialOptions.length > 0 && (
              <div className="mb-1 border-b border-border pb-1">
                {specialOptions.map(renderSpecialOption)}
              </div>
            )}

            {groups.map(group => {
              const isExpanded = expandedGroups[group.name] ?? false

              return (
                <Collapsible
                  key={group.name}
                  open={isExpanded}
                  onOpenChange={open => toggleGroup(group.name, open)}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      data-testid={`model-tree-group-${sanitizeTestId(group.name)}`}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left',
                        'hover:bg-hover focus:bg-hover focus:outline-none'
                      )}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
                      )}
                      <ModelProviderIcon groupName={group.name} className="h-4 w-4" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                        {group.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs text-text-muted">
                        {group.count}
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pb-1">
                      {group.models.map(model => renderModelOption(model, false))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        </ScrollArea>
      )}

      {footer && (
        <div data-testid="model-cascade-footer" className="shrink-0 border-t border-border">
          {footer}
        </div>
      )}
    </div>
  )
}

export function GroupedModelSelect<T extends GroupableModel>({
  models,
  selectedModel,
  selectedSpecialKey,
  specialOptions,
  labels,
  onSelectModel,
  onSelectSpecialOption,
  getModelKey = defaultModelKey,
  renderModelBadges,
  renderModelMeta,
  footer,
  placeholder,
  disabled,
  triggerClassName,
  contentClassName,
  dataTestId = 'grouped-model-select',
  align = 'start',
}: GroupedModelSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  useEffect(() => {
    if (!open) {
      setSearchValue('')
    }
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          data-testid={dataTestId}
          className={cn('h-10 w-full justify-between bg-base px-3 font-normal', triggerClassName)}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <SelectedModelProviderIcon model={selectedModel} className="h-4 w-4 shrink-0" />
            {selectedModel ? getModelDisplayName(selectedModel) : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          'w-auto overflow-hidden rounded-xl border border-border p-0 shadow-xl',
          contentClassName
        )}
      >
        <ModelCascadeContent
          models={models}
          selectedModel={selectedModel}
          selectedSpecialKey={selectedSpecialKey}
          specialOptions={specialOptions}
          labels={labels}
          searchValue={searchValue}
          onSearchValueChange={setSearchValue}
          onSelectModel={model => {
            onSelectModel(model)
            setOpen(false)
          }}
          onSelectSpecialOption={
            onSelectSpecialOption
              ? key => {
                  onSelectSpecialOption(key)
                  setOpen(false)
                }
              : undefined
          }
          getModelKey={getModelKey}
          renderModelBadges={renderModelBadges}
          renderModelMeta={renderModelMeta}
          footer={footer}
        />
      </PopoverContent>
    </Popover>
  )
}
