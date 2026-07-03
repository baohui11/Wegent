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
    <div
      className="flex h-full gap-0"
      style={{ background: 'var(--bid-paper)' }}
      data-testid="bid-review-screen"
    >
      {/* Left: TOC */}
      <div
        className="flex w-[240px] flex-shrink-0 flex-col overflow-auto p-4"
        style={{ borderRight: '1px solid var(--bid-border)', background: 'var(--bid-paper-2)' }}
      >
        <ul className="flex flex-col gap-1 text-sm">
          {sections.map(sec => {
            const st = statuses[sec.id] ?? sec.status
            const isOpen = openId === sec.id
            return (
              <li
                key={sec.id}
                onClick={() => openSection(sec.id)}
                data-testid={`bid-review-section-${sec.id}`}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2"
                style={{
                  background: isOpen ? '#fff' : 'transparent',
                  border: isOpen ? '1px solid var(--bid-border)' : '1px solid transparent',
                }}
              >
                <span
                  className="flex items-center gap-1.5 text-[13px]"
                  style={{ color: 'var(--bid-ink-2)' }}
                >
                  {accepted[sec.id] && <span style={{ color: 'var(--bid-success)' }}>✓</span>}
                  {sec.id}
                </span>
                <span
                  className="text-[10.5px]"
                  style={{ color: st === 'error' ? 'var(--bid-primary)' : 'var(--bid-muted-2)' }}
                >
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
          className="mt-4 w-full rounded-lg px-4 py-2 text-sm font-bold text-white"
          style={{ background: 'var(--bid-primary)' }}
        >
          {t('phase5.complete')}
        </button>
      </div>

      {/* Center: document preview */}
      <div className="min-w-0 flex-1 overflow-auto p-8">
        <div
          className="mx-auto max-w-[720px] rounded-2xl p-10"
          style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
          data-testid="bid-review-content"
        >
          {openId ? (
            <div style={{ fontFamily: 'var(--bid-serif)' }} className="leading-8">
              <EnhancedMarkdown source={content} theme="light" />
            </div>
          ) : (
            <div className="text-center text-sm" style={{ color: 'var(--bid-muted-2)' }}>
              {t('phase5.pick_section')}
            </div>
          )}
        </div>
      </div>

      {/* Right: content actions */}
      {openId && (
        <div
          className="flex w-[280px] flex-shrink-0 flex-col gap-3 overflow-auto p-4"
          style={{ borderLeft: '1px solid var(--bid-border)', background: 'var(--bid-paper-2)' }}
        >
          <div className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
            {t('phase4.title')} · {openId}
          </div>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder={t('phase5.instruction_placeholder')}
            data-testid="bid-review-instruction"
            rows={4}
            className="w-full resize-y rounded-lg px-3 py-2 text-sm outline-none"
            style={{ border: '1px solid var(--bid-border-2)', background: '#fff' }}
          />
          <button
            type="button"
            onClick={redraft}
            data-testid="bid-review-redraft-button"
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }}
          >
            {t('phase5.redraft')}
          </button>
          <button
            type="button"
            onClick={accept}
            data-testid="bid-review-accept-button"
            className="rounded-lg px-4 py-2 text-sm font-bold text-white"
            style={{ background: 'var(--bid-primary)' }}
          >
            {t('phase5.accept')}
          </button>
          <div
            className="mt-2 rounded-xl p-4"
            style={{ background: '#fff', border: '1px dashed var(--bid-border-2)' }}
          >
            <div className="mb-1 text-xs font-bold" style={{ color: 'var(--bid-ink-2)' }}>
              {t('outline.suggestions')}
            </div>
            <div className="text-xs" style={{ color: 'var(--bid-muted)' }}>
              {t('materials.requirements_soon')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
