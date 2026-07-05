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
import { SectionEditor, type SectionEditorApi } from './SectionEditor'
import { blockLineRange, topBlockIndexOf } from '../canvas/blockRange'

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
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  // Document-wide Edit/Read mode. Read (default) renders the whole document via
  // EnhancedMarkdown; Edit mounts a block editor per done section.
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [instruction, setInstruction] = useState('')
  const docRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const loadedRef = useRef<Set<string>>(new Set())
  // Active editable section (the one with editor focus) + per-section editor
  // APIs. In Edit mode many sections can be editable at once; the right panel
  // and paragraph regen operate on the active one. SectionEditor registers its
  // { editor, flush } here via onReady.
  const [activeId, setActiveId] = useState<string | null>(null)
  const apisRef = useRef<Map<string, SectionEditorApi>>(new Map())

  const flat = useMemo(() => flattenOutline(outline?.sections), [outline])
  const rows = useMemo(() => dfsOrder(flat), [flat])
  const nameOf = useMemo(() => new Map(flat.map(n => [n.id, n.name])), [flat])
  const chapterOrder = useMemo(() => childrenOf(flat, null).map(c => c.id), [flat])

  const loadContent = useCallback(
    async (id: string) => {
      const r = await bidApis.getSectionContent(projectId, id)
      setContents(prev => ({ ...prev, [id]: r.content }))
      setVersions(prev => ({ ...prev, [id]: r.version }))
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
    if (!focusId && sectionIds.length) {
      const first = sectionIds[0]
      setFocusId(first)
      setActiveId(first)
    }
  }, [focusId, sectionIds])

  // Flush the active editable section's pending save and return its post-save
  // version (the on-disk CAS token). SectionEditor now owns autosave, so the
  // screen reaches it via the per-section API the editor registered on mount.
  const flushActive = useCallback(async (): Promise<string> => {
    const sid = activeId ?? focusId
    const api = sid ? apisRef.current.get(sid) : undefined
    if (api) return api.flush()
    return sid ? (versions[sid] ?? '') : ''
  }, [activeId, focusId, versions])

  const redraft = useCallback(
    async (id: string, instr?: string) => {
      // Persist any pending edit first so the redraft operates on the saved
      // content (and its on-disk version).
      await flushActive()
      loadedRef.current.delete(id) // force re-fetch after this section re-drafts
      await bidApis.redraftSection(projectId, id, instr || undefined)
    },
    [projectId, flushActive]
  )

  // Regenerate the active section's cursor block only: flush the pending edit
  // so the on-disk bytes match the editor, map the block to a markdown line
  // range, then call redraft-range with the (post-flush) version. Line numbers
  // are stable only against the just-saved bytes, so flush-then-map ordering
  // matters. Declared before the early `if (!status) return` (Rules of Hooks).
  const regenBlock = useCallback(async () => {
    const sid = activeId ?? focusId
    if (!sid) return
    const api = apisRef.current.get(sid)
    const baseVersion = await flushActive()
    const md = contents[sid] ?? ''
    const idx = topBlockIndexOf(api?.editor ?? null)
    const { startLine, endLine } = blockLineRange(md, idx)
    loadedRef.current.delete(sid) // force re-fetch after the range redrafts
    await bidApis.redraftRange(
      projectId,
      sid,
      startLine,
      endLine,
      instruction || undefined,
      baseVersion
    )
    setInstruction('')
  }, [activeId, focusId, contents, instruction, projectId, flushActive])

  // Leaving Edit mode unmounts every section editor; drop their registered APIs
  // so the right panel / regen don't hold stale editor references.
  useEffect(() => {
    if (mode === 'read') apisRef.current.clear()
  }, [mode])

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
    void flushActive() // persist any in-flight edit before switching focus
    setFocusId(id)
    setActiveId(id)
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
    await flushActive() // don't accept a version that drops an unsaved edit
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

          <div className="mb-4 flex justify-end">
            <button
              type="button"
              data-testid="bid-mode-toggle"
              onClick={() => setMode(m => (m === 'read' ? 'edit' : 'read'))}
              className="rounded-md px-3 py-1 text-[11px] font-semibold"
              style={{
                border: '1px solid var(--bid-border-2)',
                color: 'var(--bid-sub)',
                fontFamily: "'Noto Sans SC', sans-serif",
              }}
            >
              {t(mode === 'read' ? 'editor.mode_edit' : 'editor.mode_read')}
            </button>
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
                    {/* Edit mode mounts a block editor for every done section;
                        Read mode renders the whole document read-only. A section
                        mid-redraft is read-only so async LLM rewrites never race
                        an in-progress edit. SectionEditor owns its own autosave
                        and registers its { editor, flush } API. */}
                    {mode === 'edit' ? (
                      <SectionEditor
                        projectId={projectId}
                        sectionId={id}
                        content={contents[id] ?? ''}
                        version={versions[id] ?? ''}
                        readOnly={status.sections[id] === 'drafting'}
                        onSaved={(sid, v) => setVersions(prev => ({ ...prev, [sid]: v }))}
                        onFocus={setActiveId}
                        onReady={(sid, api) => apisRef.current.set(sid, api)}
                      />
                    ) : (
                      <div className="bid-prose">
                        <EnhancedMarkdown source={contents[id] ?? ''} theme="light" />
                      </div>
                    )}
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
            onClick={() => void regenBlock()}
            disabled={!focusDone}
            data-testid="bid-regen-block-button"
            className="mt-2 w-full rounded-lg py-2 text-xs font-semibold disabled:cursor-not-allowed"
            style={{ border: '1px solid var(--bid-border-2)', color: 'var(--bid-sub)' }}
          >
            {t('editor.regen_block')}
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
