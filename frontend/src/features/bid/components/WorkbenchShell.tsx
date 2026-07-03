// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

const GATES = [1, 2, 3, 4, 5, 6] as const

// Maps a workbench phase to the six-gate stepper index. Read-only indicator;
// actual navigation is driven by the phase machine + backend, not this map.
function phaseToGate(phase: string): number {
  switch (phase) {
    case 'import':
    case 'creating':
    case 'parsing':
    case 'ready':
      return 1
    case 'outline_building':
    case 'outline_ready':
      return 2
    case 'materials':
    case 'materials_done':
      return 3
    case 'drafting':
      return 4
    case 'review':
    case 'review_done':
      return 5
    case 'audit':
    case 'finalizing':
    case 'done':
      return 6
    default:
      return 1
  }
}

export function WorkbenchShell({
  phase,
  title,
  onBack,
  children,
}: {
  phase: string
  title: string
  onBack: () => void
  children: ReactNode
}) {
  const { t } = useTranslation('bidWorkbench')
  const gate = phaseToGate(phase)
  return (
    <div className="flex h-full flex-col" data-testid="bid-workbench-shell">
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          data-testid="bid-workbench-back"
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary"
        >
          ← {t('projects.back')}
        </button>
        <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
        <ol data-testid="bid-stepper" className="ml-auto flex items-center gap-3">
          {GATES.map(g => (
            <li
              key={g}
              data-testid={`bid-stepper-gate-${g}`}
              data-current={g === gate ? 'true' : 'false'}
              className={
                g === gate ? 'text-xs font-semibold text-primary' : 'text-xs text-text-muted'
              }
            >
              {g} {t(`projects.phase.${g}`)}
            </li>
          ))}
        </ol>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
