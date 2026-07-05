// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type DraftStatus, type OutlineDoc } from '@/apis/bid'
import {
  childrenOf,
  dfsOrder,
  flattenOutline,
  isVisible,
  rootChapterId,
  type FlatNode,
} from '../canvas/outlineGraph'
import { EnhancedMarkdown } from '@/components/common/EnhancedMarkdown'

type SecStatus = 'pending' | 'drafting' | 'done' | 'error' | 'needs_rework'

const DOT: Record<string, string> = {
  pending: 'var(--bid-border-3)',
  drafting: 'var(--bid-warn)',
  done: 'var(--bid-success)',
  error: 'var(--bid-primary)',
  needs_rework: 'var(--bid-warn)',
}

export type DraftState = 'running' | 'done'

export function GenerateRefineScreen({
  projectId,
  outline,
  onStateChange,
}: {
  projectId: number
  outline?: OutlineDoc
  onStateChange?: (state: DraftState) => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [status, setStatus] = useState<DraftStatus | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const docRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const loadedRef = useRef<Set<string>>(new Set())

  const flat = useMemo(() => flattenOutline(outline?.sections), [outline])
  const rows = useMemo(() => dfsOrder(flat), [flat])
  const nameOf = useMemo(() => new Map(flat.map(n => [n.id, n.name])), [flat])
  const chapterOrder = useMemo(() => childrenOf(flat, null).map(c => c.id), [flat])

  const loadContent = useCallback(
    async (id: string) => {
      const r = await bidApis.getSectionContent(projectId, id)
      setContents(prev => ({ ...prev, [id]: r.content }))
    },
    [projectId]
  )

  // Accepted map (refreshed after accept).
  useEffect(() => {
    let alive = true
    void bidApis.getReviewStatus(projectId).then(r => alive && setAccepted(r.accepted))
    return () => {
      alive = false
    }
  }, [projectId])

  // Poll draft status; lazily fetch content for done sections (initial generation
  // AND single-section redrafts). Keeps polling so post-generation redrafts show.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    let prev: Record<string, string> = {}
    const poll = async () => {
      const s = await bidApis.getDraftStatus(projectId)
      if (!alive) return
      setStatus(s)
      for (const [id, st] of Object.entries(s.sections)) {
        const justFinished = prev[id] === 'drafting' && st === 'done'
        if (st === 'done' && (!loadedRef.current.has(id) || justFinished)) {
          loadedRef.current.add(id)
          void loadContent(id)
        }
      }
      prev = s.sections
    }
    void poll()
    timer = setInterval(() => void poll(), 2500)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [projectId, loadContent])

  // Surface generation state to the shell header (drives restart / proceed).
  useEffect(() => {
    if (!status) return
    onStateChange?.(status.finished ? 'done' : 'running')
  }, [status?.finished, status, onStateChange])

  const sectionIds = useMemo(() => {
    if (!status) return []
    return Object.keys(status.sections).sort((a, b) => {
      const ia = chapterOrder.indexOf(a)
      const ib = chapterOrder.indexOf(b)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
  }, [status, chapterOrder])

  useEffect(() => {
    if (!focusId && sectionIds.length) setFocusId(sectionIds[0])
  }, [focusId, sectionIds])

  const redraft = useCallback(
    async (id: string, instr?: string) => {
      loadedRef.current.delete(id) // force re-fetch after this section re-drafts
      await bidApis.redraftSection(projectId, id, instr || undefined)
    },
    [projectId]
  )

  if (!status) return null

  const doneCount = sectionIds.filter(id => status.sections[id] === 'done').length
  const generatingId = sectionIds.find(id => status.sections[id] === 'drafting')
  const focusStatus = focusId ? status.sections[focusId] : undefined
  const focusDone = focusStatus === 'done'
  const focusName = focusId ? (nameOf.get(focusId) ?? focusId) : ''

  const statusFor = (n: FlatNode): SecStatus =>
    (status.sections[n.id] ?? status.sections[rootChapterId(flat, n.id)] ?? 'pending') as SecStatus
  const scrollTo = (id: string) =>
    docRefs.current[id]?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  const focus = (id: string) => {
    setFocusId(id)
    scrollTo(id)
  }
  const toggleCollapse = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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

  return (
    <div className="flex h-full" data-testid="bid-generate-refine-screen">
      {/* Left: outline tree with per-section status + accepted + focus */}
      <div
        className="flex-shrink-0 overflow-auto px-2.5 py-3.5"
        style={{ width: 264, borderRight: '1px solid var(--bid-border)', background: '#fff' }}
      >
        <div
          className="px-2.5 pb-2.5 pt-1 text-[11px] font-extrabold"
          style={{ color: 'var(--bid-muted-2)' }}
        >
          {t('drafting.progress_title')}
        </div>
        {rows
          .filter(n => isVisible(flat, n, collapsed))
          .map(n => {
            const st = statusFor(n)
            const hasKids = flat.some(x => x.parentId === n.id)
            const isFocus = focusId === n.id
            return (
              <div
                key={n.id}
                onClick={() => focus(n.id)}
                data-testid={`bid-generate-node-${n.id}`}
                className="flex cursor-pointer items-center gap-1.5 rounded-md py-1.5"
                style={{
                  paddingLeft: 8 + n.depth * 14,
                  paddingRight: 8,
                  background: isFocus ? 'var(--bid-primary-soft)' : 'transparent',
                }}
              >
                {hasKids ? (
                  <span
                    onClick={e => {
                      e.stopPropagation()
                      toggleCollapse(n.id)
                    }}
                    className="inline-block flex-shrink-0 text-[9px]"
                    style={{
                      opacity: 0.5,
                      transform: collapsed.has(n.id) ? 'none' : 'rotate(90deg)',
                      transition: 'transform .15s',
                    }}
                  >
                    ▸
                  </span>
                ) : (
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{
                      background: DOT[st],
                      animation: st === 'drafting' ? 'pulse 1.2s ease-in-out infinite' : undefined,
                    }}
                  />
                )}
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{
                    fontSize: n.depth === 0 ? 12.5 : 12,
                    fontWeight: n.depth === 0 || isFocus ? 700 : 500,
                    color: isFocus ? 'var(--bid-primary)' : 'var(--bid-ink-2)',
                  }}
                >
                  {n.name}
                </span>
                {st === 'needs_rework' && (
                  <span className="flex-shrink-0 text-[10px]" style={{ color: 'var(--bid-warn)' }}>
                    {t('drafting.status_needs_rework')}
                  </span>
                )}
                {accepted[n.id] && <span style={{ color: 'var(--bid-success)' }}>✓</span>}
              </div>
            )
          })}
      </div>

      {/* Center: serif document, streamed then editable in place */}
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
          data-testid="bid-generate-document"
        >
          <div
            className="mb-9 border-b-[3px] pb-4 text-center"
            style={{ borderColor: 'var(--bid-primary)' }}
          >
            <div
              className="text-xs font-bold tracking-[2px]"
              style={{ color: 'var(--bid-primary)' }}
            >
              {t('drafting.doc_subtitle')}
            </div>
          </div>

          {sectionIds.map(id => {
            const st = status.sections[id] as SecStatus
            const heading = nameOf.get(id) ?? id
            return (
              <div
                key={id}
                ref={el => {
                  docRefs.current[id] = el
                }}
                className="mb-8"
                data-testid={`bid-generate-section-${id}`}
              >
                <div
                  className="mb-3.5 flex items-baseline justify-between border-b pb-2"
                  style={{ borderColor: 'var(--bid-border)' }}
                >
                  <div
                    className="text-base font-bold"
                    style={{ color: 'var(--bid-ink)', fontFamily: "'Noto Sans SC', sans-serif" }}
                  >
                    {heading}
                  </div>
                  {st === 'done' ? (
                    <span
                      onClick={() => {
                        setFocusId(id)
                        void redraft(id)
                      }}
                      className="flex-shrink-0 cursor-pointer whitespace-nowrap text-[11.5px]"
                      style={{
                        color: 'var(--bid-primary)',
                        fontFamily: "'Noto Sans SC', sans-serif",
                      }}
                    >
                      {t('review.regenerate_section')}
                    </span>
                  ) : (
                    <span
                      className="flex-shrink-0 rounded-md px-2 py-0.5 text-[11px]"
                      style={{
                        background: 'var(--bid-paper)',
                        color: 'var(--bid-muted-2)',
                        fontFamily: "'Noto Sans SC', sans-serif",
                      }}
                    >
                      {t(`phase4.status_${st}`)}
                    </span>
                  )}
                </div>

                {st === 'done' && (
                  <>
                    {/* Render section content as full Markdown (code fences,
                        GFM tables, blockquotes, emphasis, math, lists) via the
                        shared EnhancedMarkdown renderer. Scoped to the bid
                        paper look via the .bid-prose class in markdown.css. */}
                    <div className="bid-prose">
                      <EnhancedMarkdown source={contents[id] ?? ''} theme="light" />
                    </div>
                    {accepted[id] && (
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

                {(st === 'drafting' || st === 'pending') && (
                  <>
                    {st === 'drafting' && (
                      <div
                        className="mb-4 flex items-center gap-2.5 text-[13px]"
                        style={{
                          color: 'var(--bid-muted-2)',
                          fontFamily: "'Noto Sans SC', sans-serif",
                        }}
                      >
                        <span
                          className="inline-block h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full"
                          style={{
                            border: '2px solid #EEE6E4',
                            borderTopColor: 'var(--bid-primary)',
                          }}
                        />
                        {t('drafting.drafting_now')}
                      </div>
                    )}
                    <Skeleton lines={st === 'drafting' ? 4 : 3} />
                  </>
                )}

                {st === 'error' && (
                  <div
                    className="text-[13px]"
                    style={{
                      color: 'var(--bid-primary)',
                      fontFamily: "'Noto Sans SC', sans-serif",
                    }}
                    data-testid={`bid-generate-section-error-${id}`}
                  >
                    {t('phase4.section_error')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: progress strip + focused-section actions (disabled until done) */}
      <div
        className="flex w-[300px] flex-shrink-0 flex-col gap-4 overflow-auto p-4"
        style={{ borderLeft: '1px solid var(--bid-border)', background: 'var(--bid-paper-2)' }}
      >
        <div>
          <div className="mb-2 flex items-center gap-2">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full"
              style={{ background: 'var(--bid-primary-soft)' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${status.total ? Math.round((doneCount / status.total) * 100) : 0}%`,
                  background: 'var(--bid-primary)',
                }}
              />
            </div>
            <span
              className="text-xs font-bold"
              style={{ color: 'var(--bid-ink-2)' }}
              data-testid="bid-draft-progress"
            >
              {doneCount}/{status.total}
            </span>
          </div>
          <div className="text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
            {generatingId
              ? t('drafting.log_drafting', { name: nameOf.get(generatingId) ?? generatingId })
              : t('drafting.status_done')}
          </div>
        </div>

        <div style={{ opacity: focusDone ? 1 : 0.5 }}>
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
                disabled={!focusDone}
                onClick={() => focusId && void redraft(focusId, instr)}
                className="rounded-[9px] px-1.5 py-2 text-[11.5px] disabled:cursor-not-allowed"
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
            disabled={!focusDone}
            rows={3}
            className="mt-2 w-full resize-y rounded-lg px-3 py-2 text-xs outline-none disabled:cursor-not-allowed"
            style={{ border: '1px solid var(--bid-border-2)', background: '#fff' }}
          />
          <button
            type="button"
            onClick={redraftFocus}
            disabled={!focusDone}
            data-testid="bid-review-redraft-button"
            className="mt-2 w-full rounded-lg py-2 text-xs font-semibold disabled:cursor-not-allowed"
            style={{ border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }}
          >
            {t('review.redraft')}
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={!focusDone}
            data-testid="bid-review-accept-button"
            className="mt-2 w-full rounded-lg py-2.5 text-[12.5px] font-bold text-white disabled:cursor-not-allowed"
            style={{ background: 'var(--bid-primary)' }}
          >
            {t('review.accept_version')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3.5 animate-pulse rounded"
          style={{ background: '#EDE6E1', width: i === lines - 1 ? '70%' : '100%' }}
        />
      ))}
    </div>
  )
}
