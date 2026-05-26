// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import React, { useEffect, useMemo } from 'react'
import { Globe, Check, ChevronDown } from 'lucide-react'
import { ActionButton } from '@/components/ui/action-button'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/hooks/useTranslation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'
import { cn } from '@/lib/utils'
import { SearchEngine } from '@/apis/chat'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface SearchEngineSelectorProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  selectedEngine: string | null
  onSelectEngine: (engine: string) => void
  disabled?: boolean
  engines: SearchEngine[]
  /** When true, hide engine picker chevron (for compact/mobile menu layouts) */
  compact?: boolean
}

export default function SearchEngineSelector({
  enabled,
  onToggle,
  selectedEngine,
  onSelectEngine,
  disabled = false,
  engines,
  compact = false,
}: SearchEngineSelectorProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!selectedEngine && engines.length > 0) {
      onSelectEngine(engines[0].name)
    }
  }, [engines, selectedEngine, onSelectEngine])

  const currentEngine = useMemo(() => {
    return engines.find(e => e.name === selectedEngine) || engines[0]
  }, [engines, selectedEngine])

  const handleToggle = () => {
    onToggle(!enabled)
  }

  const handleSelect = (engineId: string) => {
    onSelectEngine(engineId)
    if (!enabled) {
      onToggle(true)
    }
  }

  const enabledStyles = enabled
    ? 'bg-primary/10 text-primary hover:bg-primary/20'
    : 'text-text-primary hover:bg-surface'

  const tooltipText = enabled
    ? t('chat:web_search.disable')
    : t('chat:web_search.enable')

  const showEnginePicker = !compact && engines.length > 1

  const toggleButton = (
    <ActionButton
      data-testid="web-search-toggle"
      onClick={handleToggle}
      disabled={disabled}
      icon={<Globe className="h-4 w-4" />}
      label={t('chat:web_search.label')}
      className={cn(
        'transition-colors',
        enabledStyles,
        showEnginePicker && 'rounded-r-none pr-2'
      )}
    />
  )

  if (engines.length === 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{toggleButton}</TooltipTrigger>
          <TooltipContent side="top">
            <p>{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          'inline-flex items-center',
          disabled && 'opacity-50 pointer-events-none'
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>{toggleButton}</TooltipTrigger>
          <TooltipContent side="top">
            <p>
              {tooltipText}
              {currentEngine?.display_name ? ` · ${currentEngine.display_name}` : ''}
            </p>
          </TooltipContent>
        </Tooltip>

        {showEnginePicker && (
          <>
            <div
              className={cn(
                'h-9 w-px flex-shrink-0',
                enabled ? 'bg-primary/20' : 'bg-border'
              )}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={disabled}>
                <Button
                  variant="ghost"
                  className={cn(
                    'h-9 rounded-l-none rounded-r-[24px] px-2 hover:bg-surface',
                    enabledStyles
                  )}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[180px]">
                {engines.map(engine => (
                  <DropdownMenuItem
                    key={engine.name}
                    onClick={() => handleSelect(engine.name)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <span className="text-sm font-medium">{engine.display_name}</span>
                    {selectedEngine === engine.name && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
