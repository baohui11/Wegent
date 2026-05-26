// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { ActionButton } from '@/components/ui/action-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import ClarificationToggle from '../clarification/ClarificationToggle'
import MobileCorrectionModeToggle from '../MobileCorrectionModeToggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface ChatInputMoreActionsProps {
  showClarification: boolean
  enableClarification: boolean
  setEnableClarification: (value: boolean) => void
  showCorrection: boolean
  enableCorrectionMode?: boolean
  onCorrectionModeToggle?: (enabled: boolean, modelId?: string, modelName?: string) => void
  correctionModelName?: string | null
  taskId: number | null
  disabled?: boolean
}

export default function ChatInputMoreActions({
  showClarification,
  enableClarification,
  setEnableClarification,
  showCorrection,
  enableCorrectionMode = false,
  onCorrectionModeToggle,
  correctionModelName,
  taskId,
  disabled = false,
}: ChatInputMoreActionsProps) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)

  if (!showClarification && !showCorrection) {
    return null
  }

  const hasActiveOption = enableClarification || enableCorrectionMode

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <ActionButton
            data-testid="chat-input-more-actions"
            disabled={disabled}
            icon={<Plus className="h-4 w-4" />}
            title={t('input_more_actions.tooltip')}
            className={cn(
              'transition-colors',
              hasActiveOption
                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                : 'text-text-primary hover:bg-surface'
            )}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-56 p-1">
        {showClarification && (
          <ClarificationToggle
            enabled={enableClarification}
            onToggle={setEnableClarification}
            disabled={disabled}
            triggerVariant="menu-item"
          />
        )}
        {showCorrection && onCorrectionModeToggle && (
          <MobileCorrectionModeToggle
            enabled={enableCorrectionMode}
            onToggle={onCorrectionModeToggle}
            disabled={disabled}
            correctionModelName={correctionModelName}
            taskId={taskId}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
