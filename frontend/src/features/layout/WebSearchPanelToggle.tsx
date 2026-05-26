// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useIsMobile } from '@/features/layout/hooks/useMediaQuery'
import { useTranslation } from '@/hooks/useTranslation'

interface WebSearchPanelToggleProps {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  className?: string
}

export default function WebSearchPanelToggle({
  isOpen,
  onOpen,
  onClose,
  className = '',
}: WebSearchPanelToggleProps) {
  const isMobile = useIsMobile()
  const { t } = useTranslation('chat')

  if (isMobile) {
    return null
  }

  return (
    <button
      type="button"
      onClick={isOpen ? onClose : onOpen}
      data-testid="web-search-panel-toggle"
      className={`relative w-8 h-8 rounded-[7px] bg-base border border-border hover:bg-hover focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary transition-all duration-200 ${className}`}
      title={isOpen ? t('web_search.panel.close_panel') : t('web_search.panel.open_panel')}
    >
      <svg
        className="w-3.5 h-3.5 text-text-primary absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 transition-transform duration-200"
        style={{
          transform: isOpen ? 'translate(-50%, -50%) rotate(180deg)' : 'translate(-50%, -50%)',
        }}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16z"
        />
      </svg>
    </button>
  )
}
