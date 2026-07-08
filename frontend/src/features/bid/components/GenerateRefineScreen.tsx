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
import {
  BidDocumentEditor,
  type BidDocumentEditorApi,
  type BidSectionStatus,
} from './BidDocumentEditor'
import { blockLineRange, topBlockIndexOf } from '../canvas/blockRange'
import { serializeSection } from '../canvas/serializeSection'
import { SectionProposalReview } from './SectionProposalReview'

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
  onPlaceholderCountChange,
}: {
  projectId: number
  outline?: OutlineDoc
  onStateChange?: (state: DraftState) => void
  // Unfilled placeholder count (🅓), surfaced to the shell for the proceed gate.
  onPlaceholderCountChange?: (count: number) => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [status, setStatus] = useState<DraftStatus | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  // 🅒 AI diff safety: sections with an in-flight AI revision awaiting the user's
  // accept / discard / retry. The snapshot is the pre-redraft content so discard
  // can revert it (frontend-reversible — the backend redraft is destructive).
  const [proposals, setProposals] = useState<
    Record<
      string,
      { oldContent: string; oldVersion: string; instruction?: string; isBlock: boolean }
    >
  >({})
  const docRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const loadedRef = useRef<Set<string>>(new Set())
  // Active section = the bidSection node the cursor currently sits in. Drives
  // the right panel and the paragraph-regen address. The single-document
  // editor reports it via onActiveSectionChange.
  const [activeId, setActiveId] = useState<string | null>(null)
  // Unfilled placeholder count (🅓), reported by the document editor.
  const [placeholderCount, setPlaceholderCount] = useState(0)
  // The single document editor's API (live editor instance + per-section
  // flush). Replaces the per-section apisRef Map from the stacked architecture.
  const editorApiRef = useRef<BidDocumentEditorApi | null>(null)

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

  // Flush the active section's pending save and return its post-save version
  // (the on-disk CAS token). The single-document editor owns per-section
  // autosave; we reach it via the API it registered on mount.
  const flushActive = useCallback(async (): Promise<string> => {
    const sid = activeId ?? focusId
    if (!sid) return ''
    if (editorApiRef.current) return editorApiRef.current.flushSection(sid)
    return versions[sid] ?? ''
  }, [activeId, focusId, versions])

  // Snapshot a section before an AI redraft so the change is reversible (🅒).
  // Keeps the ORIGINAL snapshot across retries, so discard always reverts to the
  // content from before the first redraft of this review cycle.
  const beginProposal = useCallback(
    (id: string, instr: string | undefined, isBlock: boolean) => {
      setProposals(prev =>
        prev[id]
          ? prev
          : {
              ...prev,
              [id]: {
                oldContent: contents[id] ?? '',
                oldVersion: versions[id] ?? '',
                instruction: instr,
                isBlock,
              },
            }
      )
    },
    [contents, versions]
  )

  const redraft = useCallback(
    async (id: string, instr?: string) => {
      // Persist any pending edit first so the redraft operates on the saved
      // content (and its on-disk version).
      await flushActive()
      beginProposal(id, instr, false) // gate the rewrite behind review (🅒)
      loadedRef.current.delete(id) // force re-fetch after this section re-drafts
      await bidApis.redraftSection(projectId, id, instr || undefined)
    },
    [projectId, flushActive, beginProposal]
  )

  // Regenerate the active section's cursor block only: flush the pending edit
  // so the on-disk bytes match the editor, map the block to a markdown line
  // range RELATIVE TO THE SECTION BODY (title-less — spike §5/§6), then call
  // redraft-range with the (post-flush) version. Line numbers are stable only
  // against the just-saved bytes, so flush-then-map ordering matters.
  // The block instruction comes from the selection bubble's ↻ popover (③),
  // NOT the section-level right-panel textarea — block and section AI are
  // separate scopes.
  const regenBlock = useCallback(
    async (instr?: string) => {
      const sid = activeId ?? focusId
      if (!sid) return
      const editor = editorApiRef.current?.editor ?? null
      const baseVersion = await flushActive()
      beginProposal(sid, instr, true) // block regen is reviewable too (🅒)
      // Serialize the section's body (title-less) — the exact bytes the backend
      // now stores — and map the cursor block (section-local index) to its line
      // range within that body.
      const sectionNode = editor ? findSectionNode(editor, sid) : null
      const md =
        sectionNode && editor ? serializeSection(editor, sectionNode) : (contents[sid] ?? '')
      const idx = topBlockIndexOf(editor, sid)
      const { startLine, endLine } = blockLineRange(md, idx)
      loadedRef.current.delete(sid) // force re-fetch after the range redrafts
      await bidApis.redraftRange(
        projectId,
        sid,
        startLine,
        endLine,
        instr || undefined,
        baseVersion
      )
    },
    [activeId, focusId, contents, projectId, flushActive, beginProposal]
  )

  // 🅒 review lifecycle. Accept keeps the regenerated content (already on disk).
  const acceptProposal = useCallback((id: string) => {
    setProposals(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  // Discard reverts to the pre-redraft snapshot: the backend redraft already
  // overwrote the file, so we write the snapshot back and re-seed the editor.
  const discardProposal = useCallback(
    async (id: string) => {
      const p = proposals[id]
      if (!p) return
      try {
        const r = await bidApis.saveSection(projectId, id, p.oldContent, versions[id] ?? '')
        setContents(prev => ({ ...prev, [id]: p.oldContent }))
        setVersions(prev => ({ ...prev, [id]: r.version }))
      } catch {
        return // leave the review open so the user can retry the discard
      }
      setProposals(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    },
    [proposals, projectId, versions]
  )

  const retryProposal = useCallback(
    (id: string) => {
      const p = proposals[id]
      if (!p) return
      if (p.isBlock) void regenBlock(p.instruction)
      else void redraft(id, p.instruction)
    },
    [proposals, redraft, regenBlock]
  )

  if (!status) return null

  const doneCount = sectionIds.filter(id => status.sections[id] === 'done').length
  const generatingId = sectionIds.find(id => status.sections[id] === 'drafting')
  const focusStatus = focusId ? status.sections[focusId] : undefined
  const focusDone = focusStatus === 'done'
  const focusName = focusId ? (nameOf.get(focusId) ?? focusId) : ''
  const focusProposal = focusId ? proposals[focusId] : undefined

  const statusFor = (n: FlatNode): BidSectionStatus =>
    (status.sections[n.id] ??
      status.sections[rootChapterId(flat, n.id)] ??
      'pending') as BidSectionStatus
  const scrollTo = (id: string) => {
    // Done sections live inside the single document editor and expose a
    // [data-bid-section] anchor (BidSectionNodeView); non-done sections still
    // render beside it with a docRefs anchor. Prefer the DOM anchor, fall back.
    const anchor =
      document.querySelector<HTMLElement>(`[data-bid-section="${id}"]`) ?? docRefs.current[id]
    anchor?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
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

  // Build the per-section specs the single-document editor renders. Only done
  // sections become bidSection nodes; mid-draft / pending sections render their
  // chrome + skeleton beside the document editor (status-driven, locked).
  const doneSections = sectionIds
    .filter(id => status.sections[id] === 'done')
    .map(id => ({
      id,
      content: contents[id] ?? '',
      version: versions[id] ?? '',
      status: status.sections[id] as BidSectionStatus,
      accepted: Boolean(accepted[id]),
    }))
  const nonDoneSections = sectionIds.filter(id => status.sections[id] !== 'done')

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
          {/* Single-document editor: all done sections as bidSection nodes.
              The editor is always editable (PR-C removed the Read/Edit toggle);
              non-done sections render beside it as locked chrome + skeleton so
              the doc still reads top-to-bottom. */}
          {doneSections.length > 0 && (
            <BidDocumentEditor
              projectId={projectId}
              sections={doneSections}
              sectionNames={Object.fromEntries(nameOf)}
              onSaved={(sid, v) => setVersions(prev => ({ ...prev, [sid]: v }))}
              onActiveSectionChange={setActiveId}
              onRegenerateBlock={instr => void regenBlock(instr)}
              onPlaceholderCountChange={n => {
                setPlaceholderCount(n)
                onPlaceholderCountChange?.(n)
              }}
              onReady={api => {
                editorApiRef.current = api
              }}
            />
          )}

          {nonDoneSections.map(id => {
            const st = status.sections[id] as BidSectionStatus
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
                    {nameOf.get(id) ?? id}
                  </div>
                  {st === 'drafting' && (
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
        {/* Section identity + status chip. Inspector IA: identity → actions →
            progress, ordered top-to-bottom by urgency (Linear/Figma model). */}
        <div className="flex items-center justify-between gap-2">
          <div
            className="min-w-0 truncate text-xs font-extrabold"
            style={{ color: 'var(--bid-sub)' }}
          >
            {focusName || t('drafting.progress_title')}
          </div>
          {focusId && (
            <span
              data-testid="bid-focus-status"
              className="flex-shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: 'var(--bid-paper)',
                color: DOT[status.sections[focusId] ?? 'pending'],
              }}
            >
              {t(`phase4.status_${status.sections[focusId] ?? 'pending'}`)}
            </span>
          )}
        </div>

        {placeholderCount > 0 && (
          <div
            data-testid="bid-placeholder-count"
            className="rounded-lg px-3 py-2 text-[11.5px] font-semibold"
            style={{
              background: 'var(--bid-paper)',
              color: 'var(--bid-warn)',
              border: '1px solid var(--bid-border-2)',
            }}
          >
            {t('editor.placeholder_count', { count: placeholderCount })}
          </div>
        )}

        <div style={{ opacity: focusDone || focusProposal ? 1 : 0.5 }}>
          {focusProposal && focusId ? (
            // 🅒 review gate: while an AI revision is pending, the panel offers
            // preview + accept / discard / retry instead of new AI actions.
            <SectionProposalReview
              sectionName={focusName}
              oldContent={focusProposal.oldContent}
              newContent={contents[focusId] ?? ''}
              pending={status.sections[focusId] === 'drafting'}
              onAccept={() => acceptProposal(focusId)}
              onDiscard={() => void discardProposal(focusId)}
              onRetry={() => retryProposal(focusId)}
            />
          ) : (
            <>
              {/* Presets are quick-fill chips for the instruction box (one
                  section-level entry point; "重写本节" below executes). Identity
                  now lives in the rail header, so no duplicate title here. */}
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {(
                  [
                    ['improve', 'review.op_improve', '优化表达，使行文更凝练'],
                    ['figure', 'review.op_figure', '补充与本节内容匹配的配图'],
                    ['structure', 'review.op_structure', '优化本节结构层次'],
                  ] as const
                ).map(([key, label, instr]) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`bid-preset-chip-${key}`}
                    disabled={!focusDone}
                    onClick={() => setInstruction(instr)}
                    className="rounded-full px-2.5 py-1 text-[11px] disabled:cursor-not-allowed"
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
            </>
          )}
        </div>

        {/* Document-level progress pinned to the bottom of the rail. */}
        <div className="mt-auto pt-2">
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
      </div>
    </div>
  )
}

// Find a top-level bidSection node by sectionId in the editor's doc, or null.
// Used by regenBlock to serialize the active section's body for line mapping.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findSectionNode(editor: any, sectionId: string): any {
  if (!editor) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let found: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.state.doc.forEach((node: any) => {
    if (found) return
    if (
      node.type &&
      node.type.name === 'bidSection' &&
      String(node.attrs?.sectionId) === sectionId
    ) {
      found = node
    }
  })
  return found
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
