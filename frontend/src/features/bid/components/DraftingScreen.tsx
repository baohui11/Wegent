// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type DraftStatus } from '@/apis/bid'

const DOT: Record<string, string> = {
  pending: 'var(--bid-border-3)',
  drafting: 'var(--bid-warn)',
  done: 'var(--bid-success)',
  error: 'var(--bid-primary)',
}

export function DraftingScreen({ projectId, onNext }: { projectId: number; onNext?: () => void }) {
  const { t } = useTranslation('bidWorkbench')
  const [status, setStatus] = useState<DraftStatus | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [content, setContent] = useState('')

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    const poll = async () => {
      const s = await bidApis.getDraftStatus(projectId)
      if (!alive) return
      setStatus(s)
      if (s.finished && timer) {
        clearInterval(timer)
        timer = null
      }
    }
    void poll()
    timer = setInterval(() => void poll(), 2500)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [projectId])

  const openSection = async (id: string) => {
    setOpenId(id)
    const r = await bidApis.getSectionContent(projectId, id)
    setContent(r.content)
  }

  if (!status) return null
  const entries = Object.entries(status.sections)
  const done = entries.filter(([, s]) => s === 'done').length
  const pct = status.total ? Math.round((done / status.total) * 100) : 0

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: 'var(--bid-paper)' }}
      data-testid="bid-drafting-screen"
    >
      <div className="flex min-h-0 flex-1">
        {/* Canvas: node grid */}
        <div
          className="min-h-0 flex-1 overflow-auto p-6"
          style={{
            background:
              'radial-gradient(circle, rgba(20,16,14,.06) 1px, transparent 1.4px) 0 0/22px 22px, var(--bid-paper-2)',
          }}
        >
          <div className="mb-4 text-[12.5px] font-bold" style={{ color: 'var(--bid-sub)' }}>
            {t('drafting.canvas')}
          </div>
          <div className="flex flex-wrap gap-3">
            {entries.map(([id, s]) => (
              <div
                key={id}
                onClick={() => s === 'done' && openSection(id)}
                data-testid={`bid-draft-section-${id}`}
                className={`flex w-[230px] items-center gap-2.5 rounded-[10px] px-3 py-2.5 ${
                  s === 'done' ? 'cursor-pointer' : ''
                }`}
                style={{
                  background: '#fff',
                  border:
                    openId === id ? '1px solid var(--bid-primary)' : '1px solid var(--bid-border)',
                }}
              >
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{
                    background: DOT[s] ?? 'var(--bid-border-3)',
                    animation: s === 'drafting' ? 'pulse 1.2s ease-in-out infinite' : undefined,
                  }}
                />
                <span className="flex-1 truncate text-[13px]" style={{ color: 'var(--bid-ink-2)' }}>
                  {id}
                </span>
                <span className="text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
                  {t(`phase4.status_${s}`)}
                </span>
              </div>
            ))}
          </div>

          {openId && (
            <div
              className="mt-5 whitespace-pre-wrap rounded-2xl p-5 text-sm"
              style={{
                background: '#fff',
                border: '1px solid var(--bid-border)',
                color: 'var(--bid-ink-2)',
              }}
              data-testid="bid-draft-viewer"
            >
              {content}
            </div>
          )}
        </div>

        {/* Right: generation log */}
        <div
          className="flex w-[320px] flex-shrink-0 flex-col"
          style={{ borderLeft: '1px solid var(--bid-border)', background: '#fff' }}
        >
          <div
            className="flex-shrink-0 px-4 py-3 text-sm font-bold"
            style={{ borderBottom: '1px solid var(--bid-border)', color: 'var(--bid-ink)' }}
          >
            {t('drafting.log')}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {done === 0 && !entries.some(([, s]) => s === 'drafting') ? (
              <div className="text-xs" style={{ color: 'var(--bid-muted-2)' }}>
                {t('drafting.empty_log')}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {entries
                  .filter(([, s]) => s === 'done' || s === 'drafting')
                  .map(([id, s]) => (
                    <div key={id} className="flex flex-col gap-0.5">
                      <span
                        className="w-fit rounded px-1.5 py-0.5 text-[10px]"
                        style={{
                          background: 'var(--bid-primary-soft)',
                          color: 'var(--bid-primary)',
                        }}
                      >
                        {t('drafting.ghostwriter')}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--bid-sub)' }}>
                        {t(s === 'done' ? 'drafting.log_done' : 'drafting.log_drafting', { id })}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom: overall progress */}
      <div
        className="flex flex-shrink-0 items-center gap-4 px-6 py-3"
        style={{ borderTop: '1px solid var(--bid-border)', background: '#fff' }}
      >
        <span className="text-xs" style={{ color: 'var(--bid-sub)' }}>
          {t('drafting.overall')}
        </span>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ background: 'var(--bid-primary-soft)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: 'var(--bid-primary)' }}
          />
        </div>
        <span
          className="text-xs font-bold"
          style={{ color: 'var(--bid-ink-2)' }}
          data-testid="bid-draft-progress"
        >
          {done}/{status.total}
        </span>
        {status.finished && (
          <span
            className="text-xs"
            style={{ color: 'var(--bid-success)' }}
            data-testid="bid-draft-finished"
          >
            {t('phase4.finished')}
          </span>
        )}
        {status.finished && onNext && (
          <button
            type="button"
            onClick={onNext}
            data-testid="bid-drafting-next-button"
            className="rounded-lg px-4 py-2 text-sm font-bold text-white"
            style={{ background: 'var(--bid-primary)' }}
          >
            {t('phase5.enter')}
          </button>
        )}
      </div>
    </div>
  )
}
