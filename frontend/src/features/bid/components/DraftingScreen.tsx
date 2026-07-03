// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type DraftStatus } from '@/apis/bid'

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

  return (
    <div className="flex h-full gap-4 p-6" data-testid="bid-drafting-screen">
      <div className="w-[300px] flex-shrink-0">
        <div className="mb-2 text-sm font-semibold" data-testid="bid-draft-progress">
          {t('phase4.progress')} {done}/{status.total}
        </div>
        {status.finished && (
          <div className="mb-2 text-sm text-success" data-testid="bid-draft-finished">
            {t('phase4.finished')}
          </div>
        )}
        {status.finished && onNext && (
          <button
            type="button"
            onClick={onNext}
            data-testid="bid-drafting-next-button"
            className="mb-2 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            {t('phase5.enter')}
          </button>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {entries.map(([id, s]) => (
            <li
              key={id}
              onClick={() => s === 'done' && openSection(id)}
              data-testid={`bid-draft-section-${id}`}
              className={`flex justify-between rounded border border-border px-2 py-1 ${
                s === 'done' ? 'cursor-pointer' : ''
              }`}
            >
              <span>{id}</span>
              <span className={s === 'error' ? 'text-error' : 'text-text-muted'}>
                {t(`phase4.status_${s}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div
        className="flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-border p-4 text-sm"
        data-testid="bid-draft-viewer"
      >
        {openId ? content : t('phase4.pick_section')}
      </div>
    </div>
  )
}
