// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react'
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

type SecStatus = 'pending' | 'drafting' | 'done' | 'error' | 'needs_rework'

const DOT: Record<string, string> = {
  pending: 'var(--bid-border-3)',
  drafting: 'var(--bid-warn)',
  done: 'var(--bid-success)',
  error: 'var(--bid-primary)',
  needs_rework: 'var(--bid-warn)',
}

// Lightweight markdown -> renderable blocks for the serif preview.
interface Block {
  kind: 'sub' | 'bullet' | 'para'
  text: string
}
function parseBody(content: string): Block[] {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('## ') && !l.startsWith('# '))
    .map(l => {
      if (l.startsWith('### ')) return { kind: 'sub' as const, text: l.slice(4) }
      if (l.startsWith('- ')) return { kind: 'bullet' as const, text: l.slice(2) }
      return { kind: 'para' as const, text: l }
    })
}

export type DraftState = 'running' | 'done'

export function DraftingScreen({
  projectId,
  outline,
  onStateChange,
}: {
  projectId: number
  outline?: OutlineDoc
  // Reports the generation state so the shell header can show the matching
  // controls (stop / resume+restart / regenerate+view-results) in its action area.
  onStateChange?: (state: DraftState) => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [status, setStatus] = useState<DraftStatus | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const docRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const flat = useMemo(() => flattenOutline(outline?.sections), [outline])
  const rows = useMemo(() => dfsOrder(flat), [flat])
  const nameOf = useMemo(() => new Map(flat.map(n => [n.id, n.name])), [flat])

  // Poll draft status and lazily fetch content for freshly-done sections.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    const poll = async () => {
      const s = await bidApis.getDraftStatus(projectId)
      if (!alive) return
      setStatus(s)
      await Promise.all(
        Object.entries(s.sections)
          .filter(([, st]) => st === 'done')
          .map(async ([id]) => {
            if (contents[id] !== undefined) return
            const r = await bidApis.getSectionContent(projectId, id)
            if (alive)
              setContents(prev => (prev[id] !== undefined ? prev : { ...prev, [id]: r.content }))
          })
      )
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
  }, [projectId, contents])

  // Surface generation state to the shell header's unified action area.
  useEffect(() => {
    if (!status) return
    onStateChange?.(status.finished ? 'done' : 'running')
  }, [status?.finished, status, onStateChange])

  if (!status) return null

  // Draft sections, ordered by the outline's chapter order when available.
  const chapterOrder = childrenOf(flat, null).map(c => c.id)
  const sectionIds = Object.keys(status.sections).sort((a, b) => {
    const ia = chapterOrder.indexOf(a)
    const ib = chapterOrder.indexOf(b)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
  const doneCount = sectionIds.filter(id => status.sections[id] === 'done').length

  // Effective per-node status: a leaf inherits its chapter's draft status.
  const statusFor = (n: FlatNode): SecStatus =>
    (status.sections[n.id] ?? status.sections[rootChapterId(flat, n.id)] ?? 'pending') as SecStatus

  const scrollTo = (id: string) =>
    docRefs.current[id]?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  const toggleCollapse = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex h-full" data-testid="bid-drafting-screen">
      {/* Left: outline tree with generation progress */}
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
            return (
              <div
                key={n.id}
                onClick={() => scrollTo(rootChapterId(flat, n.id))}
                className="flex cursor-pointer items-center gap-1.5 rounded-md py-1.5"
                style={{ paddingLeft: 8 + n.depth * 14, paddingRight: 8 }}
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
                    fontWeight: n.depth === 0 ? 700 : 500,
                    color: 'var(--bid-ink-2)',
                  }}
                >
                  {n.name}
                </span>
                {st === 'drafting' && (
                  <span className="flex-shrink-0 text-[10px]" style={{ color: 'var(--bid-warn)' }}>
                    {t('drafting.status_running')}
                  </span>
                )}
                {st === 'needs_rework' && (
                  <span className="flex-shrink-0 text-[10px]" style={{ color: 'var(--bid-warn)' }}>
                    {t('drafting.status_needs_rework')}
                  </span>
                )}
              </div>
            )
          })}
      </div>

      {/* Center: live serif document preview (card grows to fit its content) */}
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
          data-testid="bid-draft-document"
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
            const blocks = st === 'done' ? parseBody(contents[id] ?? '') : []
            return (
              <div
                key={id}
                ref={el => {
                  docRefs.current[id] = el
                }}
                className="mb-8"
                data-testid={`bid-draft-section-${id}`}
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
                  <span
                    className="flex-shrink-0 rounded-md px-2 py-0.5 text-[11px]"
                    style={{
                      background: st === 'done' ? 'var(--bid-success-soft)' : 'var(--bid-paper)',
                      color: st === 'done' ? 'var(--bid-success)' : 'var(--bid-muted-2)',
                      fontFamily: "'Noto Sans SC', sans-serif",
                    }}
                  >
                    {t(`phase4.status_${st}`)}
                  </span>
                </div>

                {st === 'done' &&
                  blocks.map((b, i) =>
                    b.kind === 'sub' ? (
                      <div
                        key={i}
                        className="mb-2 mt-3 text-[15px] font-bold"
                        style={{ color: 'var(--bid-ink)' }}
                      >
                        {b.text}
                      </div>
                    ) : b.kind === 'bullet' ? (
                      <div
                        key={i}
                        className="mb-1.5 pl-6 text-[14.5px] leading-[2]"
                        style={{ color: 'var(--bid-ink-2)' }}
                      >
                        • {b.text}
                      </div>
                    ) : (
                      <p
                        key={i}
                        className="mb-3 text-[14.5px] leading-[2]"
                        style={{ color: 'var(--bid-ink-2)', textIndent: '2em' }}
                      >
                        {b.text}
                      </p>
                    )
                  )}

                {st === 'drafting' && (
                  <>
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
                    <Skeleton lines={4} />
                  </>
                )}

                {st === 'pending' && <Skeleton lines={3} />}

                {st === 'error' && (
                  <div
                    className="text-[13px]"
                    style={{
                      color: 'var(--bid-primary)',
                      fontFamily: "'Noto Sans SC', sans-serif",
                    }}
                    data-testid={`bid-draft-section-error-${id}`}
                  >
                    {t('phase4.section_error')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: generation log + overall progress */}
      <div
        className="flex w-[340px] flex-shrink-0 flex-col"
        style={{ borderLeft: '1px solid var(--bid-border)', background: '#fff' }}
      >
        <div
          className="flex flex-shrink-0 items-center justify-between px-4 py-3.5"
          style={{ borderBottom: '1px solid var(--bid-border)' }}
        >
          <span className="text-[13px] font-bold" style={{ color: 'var(--bid-ink)' }}>
            {t('drafting.gen_log')}
          </span>
          <span
            className="rounded-md px-2 py-0.5 text-[11px] font-bold"
            style={
              status.finished
                ? { background: 'var(--bid-success-soft)', color: 'var(--bid-success)' }
                : { background: 'var(--bid-primary-soft)', color: 'var(--bid-primary)' }
            }
          >
            {status.finished ? t('drafting.status_done') : t('drafting.status_running')}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
          {sectionIds
            .filter(
              id =>
                status.sections[id] === 'done' ||
                status.sections[id] === 'drafting' ||
                status.sections[id] === 'error'
            )
            .map(id => {
              const st = status.sections[id]
              const name = nameOf.get(id) ?? id
              return (
                <div key={id} className="text-xs leading-relaxed">
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-bold"
                    style={{ background: 'var(--bid-primary-soft)', color: 'var(--bid-primary)' }}
                  >
                    {t('drafting.ghostwriter')}
                  </span>
                  <div className="mt-1" style={{ color: 'var(--bid-ink-2)' }}>
                    {t(
                      st === 'done'
                        ? 'drafting.log_done'
                        : st === 'error'
                          ? 'drafting.log_error'
                          : 'drafting.log_drafting',
                      { name }
                    )}
                  </div>
                </div>
              )
            })}
        </div>

        <div
          className="flex-shrink-0 px-4 py-3"
          style={{ borderTop: '1px solid var(--bid-border)' }}
        >
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
