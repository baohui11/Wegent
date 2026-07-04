// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type DraftSection, type OutlineDoc } from '@/apis/bid'
import { childrenOf, flattenOutline } from '../canvas/outlineGraph'

// Lightweight markdown -> paragraphs for the serif preview.
function parseParagraphs(content: string): string[] {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => (l.startsWith('- ') ? `· ${l.slice(2)}` : l))
}

export function ReviewScreen({ projectId, outline }: { projectId: number; outline?: OutlineDoc }) {
  const { t } = useTranslation('bidWorkbench')
  const [sections, setSections] = useState<DraftSection[]>([])
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [contents, setContents] = useState<Record<string, string>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [ready, setReady] = useState(false)
  const docRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const flat = useMemo(() => flattenOutline(outline?.sections), [outline])
  const nameOf = useMemo(() => new Map(flat.map(n => [n.id, n.name])), [flat])

  const loadContent = useCallback(
    async (id: string) => {
      const r = await bidApis.getSectionContent(projectId, id)
      setContents(prev => ({ ...prev, [id]: r.content }))
    },
    [projectId]
  )

  // Initial load: sections + accepted map + all section bodies.
  useEffect(() => {
    let alive = true
    void (async () => {
      const [secs, rev] = await Promise.all([
        bidApis.getDraftSections(projectId),
        bidApis.getReviewStatus(projectId),
      ])
      if (!alive) return
      // Order sections by the outline's chapter order when available.
      const order = childrenOf(flat, null).map(c => c.id)
      const rank = (id: string) => (order.indexOf(id) === -1 ? 999 : order.indexOf(id))
      const items = [...secs.items].sort((a, b) => rank(a.id) - rank(b.id))
      setSections(items)
      setAccepted(rev.accepted)
      setFocusId(prev => prev ?? items[0]?.id ?? null)
      setReady(true)
      await Promise.all(items.filter(s => s.status === 'done').map(s => loadContent(s.id)))
    })()
    return () => {
      alive = false
    }
  }, [projectId, flat, loadContent])

  // Poll for re-draft completion and refresh that section's content.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    let prev: Record<string, string> = {}
    const poll = async () => {
      const s = await bidApis.getDraftStatus(projectId)
      if (!alive) return
      Object.entries(s.sections).forEach(([id, st]) => {
        if (prev[id] === 'drafting' && st === 'done') void loadContent(id)
      })
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

  const focusName = focusId ? (nameOf.get(focusId) ?? focusId) : ''

  const redraft = useCallback(
    async (id: string, instr?: string) => {
      await bidApis.redraftSection(projectId, id, instr || undefined)
    },
    [projectId]
  )
  const redraftFocus = () => {
    if (!focusId) return
    void redraft(focusId, instruction)
    setInstruction('')
  }
  const accept = async () => {
    if (!focusId) return
    await bidApis.acceptSection(projectId, focusId)
    setAccepted((await bidApis.getReviewStatus(projectId)).accepted)
  }

  const focus = (id: string) => {
    setFocusId(id)
    docRefs.current[id]?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  if (!ready) return null

  return (
    <div className="flex h-full" data-testid="bid-review-screen">
      {/* Left: section TOC */}
      <div
        className="flex w-[264px] flex-shrink-0 flex-col overflow-auto px-2.5 py-3.5"
        style={{ borderRight: '1px solid var(--bid-border)', background: '#fff' }}
      >
        <div className="flex flex-1 flex-col gap-0.5">
          {sections.map(sec => {
            const st = statuses[sec.id] ?? sec.status
            const isFocus = focusId === sec.id
            return (
              <div
                key={sec.id}
                onClick={() => focus(sec.id)}
                data-testid={`bid-review-section-${sec.id}`}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2"
                style={{ background: isFocus ? 'var(--bid-primary-soft)' : 'transparent' }}
              >
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{
                    background: st === 'drafting' ? 'var(--bid-warn)' : 'var(--bid-success)',
                    animation: st === 'drafting' ? 'pulse 1.2s ease-in-out infinite' : undefined,
                  }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[12.5px]"
                  style={{
                    color: isFocus ? 'var(--bid-primary)' : 'var(--bid-ink-2)',
                    fontWeight: isFocus ? 700 : 500,
                  }}
                >
                  {nameOf.get(sec.id) ?? sec.id}
                </span>
                {accepted[sec.id] && <span style={{ color: 'var(--bid-success)' }}>✓</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Center: full serif document (card grows to fit its content) */}
      <div
        className="flex flex-1 items-start justify-center overflow-auto p-10"
        style={{ background: '#EDEAE6' }}
      >
        <div
          className="w-[720px] flex-shrink-0 px-16 py-14"
          style={{
            background: '#fff',
            boxShadow: '0 2px 16px rgba(0,0,0,.08)',
            fontFamily: 'var(--bid-serif)',
          }}
          data-testid="bid-review-content"
        >
          <div
            className="mb-9 border-b-[3px] pb-4 text-center"
            style={{ borderColor: 'var(--bid-primary)' }}
          >
            <div
              className="text-xs font-bold tracking-[2px]"
              style={{ color: 'var(--bid-primary)' }}
            >
              {t('review.doc_subtitle')}
            </div>
          </div>

          {sections.map(sec => {
            const st = statuses[sec.id] ?? sec.status
            const paras = parseParagraphs(contents[sec.id] ?? '')
            return (
              <div
                key={sec.id}
                ref={el => {
                  docRefs.current[sec.id] = el
                }}
                className="mb-8"
              >
                <div
                  className="mb-3.5 flex items-baseline justify-between border-b pb-2"
                  style={{ borderColor: 'var(--bid-border)' }}
                >
                  <div
                    className="text-base font-bold"
                    style={{ color: 'var(--bid-ink)', fontFamily: "'Noto Sans SC', sans-serif" }}
                  >
                    {nameOf.get(sec.id) ?? sec.id}
                  </div>
                  <span
                    onClick={() => {
                      setFocusId(sec.id)
                      void redraft(sec.id)
                    }}
                    className="flex-shrink-0 cursor-pointer whitespace-nowrap text-[11.5px]"
                    style={{
                      color: 'var(--bid-primary)',
                      fontFamily: "'Noto Sans SC', sans-serif",
                    }}
                  >
                    {t('review.regenerate_section')}
                  </span>
                </div>

                {st === 'drafting' ? (
                  <div
                    className="flex items-center gap-2.5 py-6 text-[13px]"
                    style={{
                      color: 'var(--bid-muted-2)',
                      fontFamily: "'Noto Sans SC', sans-serif",
                    }}
                  >
                    <span
                      className="inline-block h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full"
                      style={{ border: '2px solid #EEE6E4', borderTopColor: 'var(--bid-primary)' }}
                    />
                    {t('review.regenerating')}
                  </div>
                ) : (
                  <>
                    {paras.map((p, i) => (
                      <p
                        key={i}
                        className="mb-3 text-[14.5px] leading-[2]"
                        style={{
                          color: 'var(--bid-ink-2)',
                          textIndent: p.startsWith('·') ? 0 : '2em',
                        }}
                      >
                        {p}
                      </p>
                    ))}
                    {accepted[sec.id] && (
                      <div
                        className="inline-block rounded-md px-2 py-0.5 text-[10.5px]"
                        style={{
                          background: 'var(--bid-primary-soft)',
                          color: 'var(--bid-primary)',
                          fontFamily: "'Noto Sans SC', sans-serif",
                        }}
                      >
                        {t('review.accepted_badge')}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: content actions for the focused section */}
      <div
        className="flex w-[300px] flex-shrink-0 flex-col gap-4 overflow-auto p-4"
        style={{ borderLeft: '1px solid var(--bid-border)', background: 'var(--bid-paper-2)' }}
      >
        <div>
          <div className="mb-2 truncate text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
            {t('review.content_ops')} · {focusName}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['review.op_regenerate', ''],
                ['review.op_improve', '优化表达，使行文更凝练'],
                ['review.op_figure', '补充与本节内容匹配的配图'],
                ['review.op_structure', '优化本节结构层次'],
              ] as const
            ).map(([label, instr]) => (
              <button
                key={label}
                type="button"
                onClick={() => focusId && void redraft(focusId, instr)}
                className="rounded-[9px] px-1.5 py-2 text-[11.5px]"
                style={{
                  background: '#fff',
                  border: '1px solid var(--bid-border)',
                  color: 'var(--bid-sub)',
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder={t('review.instruction_placeholder')}
            data-testid="bid-review-instruction"
            rows={3}
            className="mt-2 w-full resize-y rounded-lg px-3 py-2 text-xs outline-none"
            style={{ border: '1px solid var(--bid-border-2)', background: '#fff' }}
          />
          <button
            type="button"
            onClick={redraftFocus}
            data-testid="bid-review-redraft-button"
            className="mt-2 w-full rounded-lg py-2 text-xs font-semibold"
            style={{ border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }}
          >
            {t('review.redraft')}
          </button>
          <button
            type="button"
            onClick={accept}
            data-testid="bid-review-accept-button"
            className="mt-2 w-full rounded-lg py-2.5 text-[12.5px] font-bold text-white"
            style={{ background: 'var(--bid-primary)' }}
          >
            {t('review.accept_version')}
          </button>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
              {t('review.suggestions')}
            </div>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px]"
              style={{ background: 'var(--bid-primary-soft)', color: 'var(--bid-primary)' }}
            >
              {t('review.ai_badge')}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {['review.sug_1', 'review.sug_2', 'review.sug_3'].map(k => (
              <div
                key={k}
                className="rounded-[10px] p-2.5"
                style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
              >
                <div
                  className="mb-2 text-[11px] leading-relaxed"
                  style={{ color: 'var(--bid-muted)' }}
                >
                  {t(k)}
                </div>
                <span
                  onClick={() => focusId && void redraft(focusId, t(k))}
                  className="cursor-pointer rounded-md px-2.5 py-1 text-[11px] text-white"
                  style={{ background: 'var(--bid-primary)' }}
                >
                  {t('outline.accept')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
