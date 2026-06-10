// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useIsMobile } from '@/features/layout/hooks/useMediaQuery'
import { useTranslation } from '@/hooks/useTranslation'

export type SettingsTabId = 'general' | 'integrations' | 'api-keys' | 'group-manager' | 'pet'

interface SettingsTabNavProps {
  activeTab: SettingsTabId
  onTabChange: (tab: SettingsTabId) => void
  /** When false, hides the API Keys tab (admin-only). Defaults to true. */
  showApiKeysTab?: boolean
}

interface TabItem {
  id: SettingsTabId
  label: string
}

export function SettingsTabNav({
  activeTab,
  onTabChange,
  showApiKeysTab = true,
}: SettingsTabNavProps) {
  const { t } = useTranslation('settings')
  const isMobile = useIsMobile()

  const tabs: TabItem[] = useMemo(() => {
    const allTabs: TabItem[] = [
      { id: 'general', label: t('sections.general') },
      { id: 'integrations', label: t('navigation.integrations') },
      { id: 'api-keys', label: t('navigation.apiKeys') },
      { id: 'group-manager', label: t('navigation.groupManager') },
      { id: 'pet', label: t('pet:title') },
    ]
    return showApiKeysTab ? allTabs : allTabs.filter(tab => tab.id !== 'api-keys')
  }, [showApiKeysTab, t])

  if (isMobile) {
    return (
      <div className="border-t border-border bg-surface px-4 py-2">
        <Select value={activeTab} onValueChange={value => onTabChange(value as SettingsTabId)}>
          <SelectTrigger className="h-11 w-full">
            <SelectValue placeholder={t('sections.general')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {tabs.map(tab => (
                <SelectItem key={tab.id} value={tab.id}>
                  {tab.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className="border-t border-border bg-surface">
      <div className="flex items-center gap-1 overflow-x-auto px-4 py-2">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`relative rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200 ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-secondary hover:bg-muted hover:text-text-primary'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default SettingsTabNav
