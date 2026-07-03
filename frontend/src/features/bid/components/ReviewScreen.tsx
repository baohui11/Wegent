// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { EnhancedMarkdown } from '@/components/common/EnhancedMarkdown'
import { bidApis, type DraftSection } from '@/apis/bid'

export function ReviewScreen({
  projectId,
  onComplete,
}: {
  projectId: number
  onComplete: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [sections, setSections] = useState<DraftSection[]>([])
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [instruction, setInstruction] = useState('')
  const [ready, setReady] = useState(false)
  const openIdRef = useRef<string | null>(null)
  openIdRef.current = openId

  const loadContent = useCallback(
    async (id: string) => {
      const r = await bidApis.getSectionContent(projectId, id)
      setContent(r.content)
    },
    [projectId]
  )

  const openSection = useCallback(
    async (id: string) => {
      setOpenId(id)
      await loadContent(id)
    },
    [loadContent]
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      const [secs, rev] = await Promise.all([
        bidApis.getDraftSections(projectId),
        bidApis.getReviewStatus(projectId),
      ])
      if (!alive) return
      setSections(secs.items)
      setAccepted(rev.accepted)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [projectId])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    let prev: Record<string, string> = {}
    const poll = async () => {
      const s = await bidApis.getDraftStatus(projectId)
      if (!alive) return
      const oid = openIdRef.current
      // re-read the open section when it just flipped drafting -> done
      if (oid && prev[oid] === 'drafting' && s.sections[oid] === 'done') void loadContent(oid)
      prev = s.sections
      setStatuses(s.sections)
    }
    void poll()
    timer = setInterval(() => void poll(), 2500)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [projectId, loadContent])

  const redraft = async () => {
    if (!openId) return
    await bidApis.redraftSection(projectId, openId, instruction || undefined)
    setInstruction('')
  }
  const accept = async () => {
    if (!openId) return
    await bidApis.acceptSection(projectId, openId)
    setAccepted((await bidApis.getReviewStatus(projectId)).accepted)
  }

  if (!ready) return null

  return (
    <div className="flex h-full gap-4 p-6" data-testid="bid-review-screen">
      <div className="w-[240px] flex-shrink-0 overflow-auto">
        <ul className="flex flex-col gap-1 text-sm">
          {sections.map(sec => {
            const st = statuses[sec.id] ?? sec.status
            return (
              <li
                key={sec.id}
                onClick={() => openSection(sec.id)}
                data-testid={`bid-review-section-${sec.id}`}
                className={`flex cursor-pointer justify-between rounded border border-border px-2 py-1 ${
                  openId === sec.id ? 'bg-surface' : ''
                }`}
              >
                <span>
                  {sec.id}
                  {accepted[sec.id] ? ' ✓' : ''}
                </span>
                <span className={st === 'error' ? 'text-error' : 'text-text-muted'}>
                  {t(`phase4.status_${st}`)}
                </span>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          onClick={onComplete}
          data-testid="bid-review-complete-button"
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          {t('phase5.complete')}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-auto">
        <div
          className="flex-1 overflow-auto rounded-lg border border-border p-4"
          data-testid="bid-review-content"
        >
          {openId ? (
            <EnhancedMarkdown source={content} theme="light" />
          ) : (
            <span className="text-text-muted">{t('phase5.pick_section')}</span>
          )}
        </div>
        {openId && (
          <div className="flex flex-col gap-2">
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder={t('phase5.instruction_placeholder')}
              data-testid="bid-review-instruction"
              className="min-h-[64px] w-full rounded-lg border border-border p-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={redraft}
                data-testid="bid-review-redraft-button"
                className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
              >
                {t('phase5.redraft')}
              </button>
              <button
                type="button"
                onClick={accept}
                data-testid="bid-review-accept-button"
                className="rounded-lg bg-primary px-4 py-2 text-sm text-white"
              >
                {t('phase5.accept')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
