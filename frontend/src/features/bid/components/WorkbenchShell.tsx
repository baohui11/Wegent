// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

const STAGES = [1, 2, 3, 4, 5] as const

// Maps a workbench phase to the mockup's five-stage stepper index. Read-only
// indicator; navigation is driven by the phase machine + backend, not clicks.
function phaseToStage(phase: string): number {
  switch (phase) {
    case 'import':
    case 'creating':
    case 'parsing':
    case 'ready':
    case 'outline_building':
    case 'outline_ready':
      return 1
    case 'materials':
    case 'materials_done':
      return 2
    case 'drafting':
      return 3
    case 'review':
    case 'review_done':
      return 4
    case 'audit':
    case 'finalizing':
    case 'done':
      return 5
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
  const current = phaseToStage(phase)

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: 'var(--bid-paper)', color: 'var(--bid-ink)' }}
      data-testid="bid-workbench-shell"
    >
      {/* Stage stepper */}
      <div
        data-testid="bid-stepper"
        className="flex flex-shrink-0 items-center overflow-x-auto"
        style={{
          background: '#fff',
          borderBottom: '1px solid var(--bid-border)',
          padding: '14px 28px',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          data-testid="bid-workbench-back"
          className="mr-5 flex-shrink-0 rounded-lg px-3 py-1.5 text-xs"
          style={{ border: '1px solid var(--bid-border-2)', color: 'var(--bid-sub)' }}
        >
          ← {t('projects.back')}
        </button>
        {STAGES.map((s, i) => {
          const done = s < current
          const active = s === current
          const circleBg = active ? 'var(--bid-primary)' : done ? 'var(--bid-success)' : '#F1EEEB'
          const circleColor = active || done ? '#fff' : 'var(--bid-muted-3)'
          const labelColor = active
            ? 'var(--bid-primary)'
            : done
              ? 'var(--bid-ink-2)'
              : 'var(--bid-muted-2)'
          return (
            <div key={s} className="flex flex-shrink-0 items-center">
              <div
                data-testid={`bid-stepper-stage-${s}`}
                data-current={active ? 'true' : 'false'}
                className="flex items-center gap-2.5"
              >
                <div
                  className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: circleBg, color: circleColor }}
                >
                  {done ? '✓' : s}
                </div>
                <div>
                  <div
                    className="whitespace-nowrap text-[12.5px] font-bold"
                    style={{ color: labelColor }}
                  >
                    {t(`stages.${s}.label`)}
                  </div>
                  <div
                    className="whitespace-nowrap text-[10.5px]"
                    style={{ color: 'var(--bid-muted-3)' }}
                  >
                    {t(`stages.${s}.desc`)}
                  </div>
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <div
                  className="w-7 flex-shrink-0 text-center text-sm"
                  style={{ color: 'var(--bid-border-3)' }}
                >
                  →
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Phase header */}
      <div
        className="flex h-[60px] flex-shrink-0 items-center justify-between overflow-x-auto px-7"
        style={{ background: '#fff', borderBottom: '1px solid var(--bid-border)' }}
      >
        <div className="min-w-0">
          <div
            className="truncate text-[15.5px] font-extrabold"
            style={{ color: 'var(--bid-ink)' }}
          >
            {t(`phaseHeader.${current}.title`)}
          </div>
          <div className="truncate text-[11.5px]" style={{ color: 'var(--bid-muted-2)' }}>
            {t(`phaseHeader.${current}.subtitle`)}
          </div>
        </div>
        <div
          className="ml-4 flex-shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs"
          style={{
            background: 'var(--bid-paper-2)',
            color: 'var(--bid-sub)',
            border: '1px solid var(--bid-border)',
          }}
        >
          {title}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
