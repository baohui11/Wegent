// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import type { CoverageReport, OutlineDoc, OutlineNode } from '@/apis/bid'

const PARSE_STEPS = ['ocr', 'toc', 'classify', 'tree'] as const

// Chapter accent colours cycled across top-level sections (mockup palette).
const ACCENTS = ['#C7102A', '#C77700', '#1E8E5A', '#8E2140', '#2A6FDB', '#7A56C7']

// Canvas layout constants.
const CHAP_W = 210
const CHAP_H = 46
const LEAF_W = 248
const LEAF_H = 40
const LEAF_GAP = 52
const BAND_GAP = 26
const CHAP_X = 28
const LEAF_X = 300
const TOP = 24

function countLeaves(nodes: OutlineNode[]): number {
  return nodes.reduce(
    (n, x) => n + (x.children && x.children.length ? countLeaves(x.children) : 1),
    0
  )
}
function mapTree(nodes: OutlineNode[], fn: (n: OutlineNode) => OutlineNode): OutlineNode[] {
  return nodes.map(n => {
    const next = fn(n)
    return next.children ? { ...next, children: mapTree(next.children, fn) } : next
  })
}
function removeNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  return nodes
    .filter(n => n.id !== id)
    .map(n => (n.children ? { ...n, children: removeNode(n.children, id) } : n))
}

interface LaidNode {
  id: string
  kind: 'chapter' | 'leaf'
  x: number
  y: number
  w: number
  h: number
  title: string
  accent: string
  covers: string[]
  hidden: number
  hasChildren: boolean
}
interface Edge {
  d: string
  accent: string
}

export function OutlineCanvas({
  outline,
  coverage,
  title,
  onSave,
  parsing = false,
}: {
  outline?: OutlineDoc
  coverage?: CoverageReport
  title: string
  onSave?: (o: OutlineDoc) => void
  // When true, the tender is still being parsed: the left column shows the
  // parse-progress card and the canvas shows a skeleton (design's in-canvas
  // parsing state) instead of the populated outline.
  parsing?: boolean
}) {
  const { t } = useTranslation('bidWorkbench')
  const sections = useMemo(() => outline?.sections ?? [], [outline])
  const cov = coverage ?? { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] }
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(1)
  const [edits, setEdits] = useState(0)
  const [parseStep, setParseStep] = useState(0)

  // Cycle the parse-progress steps while parsing (visual only).
  useEffect(() => {
    if (!parsing) return
    setParseStep(0)
    const id = setInterval(() => setParseStep(s => (s + 1) % PARSE_STEPS.length), 1100)
    return () => clearInterval(id)
  }, [parsing])

  const matches = (name?: string) =>
    !search || (name || '').toLowerCase().includes(search.toLowerCase())

  const stats = useMemo(() => {
    const l2 = sections.reduce((n, c) => n + (c.children?.length ?? 0), 0)
    const l3 = sections.reduce(
      (n, c) => n + (c.children?.reduce((m, x) => m + (x.children?.length ?? 0), 0) ?? 0),
      0
    )
    return [
      { value: sections.length, label: t('outline.chapters') },
      { value: l2, label: t('outline.level2') },
      { value: l3, label: t('outline.level3') },
      { value: countLeaves(sections), label: t('outline.leaves') },
      { value: cov.total, label: t('outline.scoring_points') },
    ]
  }, [sections, cov.total, t])

  // Positioned mind-map layout (bands per chapter; leaves branch to the right).
  const layout = useMemo(() => {
    const nodes: LaidNode[] = []
    const edges: Edge[] = []
    let y = TOP
    const visChapters = sections.filter(
      c => matches(c.title) || (c.children || []).some(l => matches(l.title))
    )
    visChapters.forEach((ch, ci) => {
      const accent = ACCENTS[ci % ACCENTS.length]
      const isCollapsed = collapsed.has(ch.id ?? '') && !search
      const allLeaves = ch.children ?? []
      const leaves = isCollapsed ? [] : allLeaves.filter(l => matches(l.title) || matches(ch.title))
      const bandH = Math.max(CHAP_H + 8, leaves.length * LEAF_GAP)
      const chY = y + bandH / 2 - CHAP_H / 2
      nodes.push({
        id: ch.id ?? `c${ci}`,
        kind: 'chapter',
        x: CHAP_X,
        y: chY,
        w: CHAP_W,
        h: CHAP_H,
        title: ch.title || '',
        accent,
        covers: ch.covers ?? [],
        hidden: isCollapsed ? allLeaves.length : 0,
        hasChildren: allLeaves.length > 0,
      })
      const offset = (bandH - leaves.length * LEAF_GAP) / 2
      leaves.forEach((lf, li) => {
        const ly = y + li * LEAF_GAP + offset + (LEAF_GAP - LEAF_H) / 2
        nodes.push({
          id: lf.id ?? `${ci}-${li}`,
          kind: 'leaf',
          x: LEAF_X,
          y: ly,
          w: LEAF_W,
          h: LEAF_H,
          title: lf.title || '',
          accent,
          covers: lf.covers ?? [],
          hidden: 0,
          hasChildren: false,
        })
        const x1 = CHAP_X + CHAP_W
        const y1 = chY + CHAP_H / 2
        const x2 = LEAF_X
        const y2 = ly + LEAF_H / 2
        edges.push({ d: `M ${x1} ${y1} C ${x1 + 44} ${y1}, ${x2 - 44} ${y2}, ${x2} ${y2}`, accent })
      })
      y += bandH + BAND_GAP
    })
    return { nodes, edges, width: LEAF_X + LEAF_W + 48, height: Math.max(y, 240) }
  }, [sections, collapsed, search]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => {
    let found: OutlineNode | null = null
    let parent: OutlineNode | null = null
    const walk = (nodes: OutlineNode[], p: OutlineNode | null) => {
      for (const n of nodes) {
        if (n.id === selectedId) {
          found = n
          parent = p
        }
        if (n.children) walk(n.children, n)
      }
    }
    walk(sections, null)
    return { node: found as OutlineNode | null, parent: parent as OutlineNode | null }
  }, [sections, selectedId])

  const bump = () => setEdits(e => e + 1)
  const commitRename = () => {
    if (!editingId) return
    const id = editingId
    const value = draft.trim()
    setEditingId(null)
    if (value) {
      onSave?.({
        ...outline,
        sections: mapTree(sections, n => (n.id === id ? { ...n, title: value } : n)),
      })
      bump()
    }
  }
  const deleteNode = (id: string) => {
    onSave?.({ ...outline, sections: removeNode(sections, id) })
    bump()
  }
  const addChild = (chapterId: string) => {
    const nid = `n${Date.now()}`
    onSave?.({
      ...outline,
      sections: mapTree(sections, n =>
        n.id === chapterId
          ? { ...n, children: [...(n.children ?? []), { id: nid, title: t('phase2.new_node') }] }
          : n
      ),
    })
    bump()
  }
  const acceptSuggestion = (id: string) => {
    const first = sections[0]
    if (first?.id) {
      onSave?.({
        ...outline,
        sections: mapTree(sections, n =>
          n.id === first.id
            ? {
                ...n,
                children: [
                  ...(n.children ?? []),
                  { id: `s${Date.now()}`, title: t('outline.new_leaf', { id }), covers: [id] },
                ],
              }
            : n
        ),
      })
      bump()
    }
    setDismissed(prev => new Set(prev).add(id))
  }
  const toggleCollapse = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const sectionLabel = 'text-xs font-extrabold'
  const sideCol = 'flex flex-shrink-0 flex-col gap-4 overflow-auto p-4'
  const pill =
    'flex-shrink-0 whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[11.5px] cursor-pointer'

  const suggestions = [
    ...cov.uncovered_scoring
      .filter(id => !dismissed.has(id))
      .map(id => ({ id, kind: 'scoring' as const })),
    ...cov.uncovered_clauses
      .filter(id => !dismissed.has(id))
      .map(id => ({ id, kind: 'clause' as const })),
  ]

  return (
    <div className="flex h-full overflow-x-auto" data-testid="bid-outline-editor">
      {/* Left: files / stats / log */}
      <div
        className={sideCol}
        style={{
          width: 272,
          borderRight: '1px solid var(--bid-border)',
          background: 'var(--bid-paper-2)',
        }}
      >
        <div>
          <div className={`mb-2 ${sectionLabel}`} style={{ color: 'var(--bid-sub)' }}>
            {t('outline.tender_file')}
            <span
              className="ml-1.5 text-[10.5px] font-medium"
              style={{ color: 'var(--bid-muted-2)' }}
            >
              {t('outline.file_count', { count: 1 })}
            </span>
          </div>
          <div
            className="flex items-center gap-2.5 rounded-[10px] p-3"
            style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
          >
            <div
              className="flex h-8 w-7 flex-shrink-0 items-center justify-center rounded-[5px] text-sm"
              style={{ background: 'var(--bid-primary-soft)' }}
            >
              📄
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[11.5px] font-bold"
                style={{ color: 'var(--bid-ink-2)' }}
              >
                {title || t('outline.tender_file')}
              </div>
              <div className="mt-0.5 text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
                2.2 KB ·{' '}
                <span style={{ color: 'var(--bid-success)' }}>✓ {t('outline.parsed_ok')}</span>
              </div>
            </div>
          </div>
          {!parsing && (
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg py-2 text-[11.5px]"
                style={{
                  background: '#fff',
                  border: '1px solid var(--bid-border-2)',
                  color: 'var(--bid-sub)',
                  cursor: 'pointer',
                }}
              >
                ↺ {t('outline.reupload')}
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg py-2 text-[11.5px]"
                style={{
                  background: '#fff',
                  border: '1px solid var(--bid-border-2)',
                  color: 'var(--bid-sub)',
                  cursor: 'pointer',
                }}
              >
                ✦ {t('outline.reparse')}
              </button>
            </div>
          )}
        </div>

        {parsing && (
          <div
            className="rounded-[10px] p-3"
            style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
            data-testid="bid-outline-parsing"
          >
            <div className="mb-3 flex items-center gap-2">
              <div
                className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full"
                style={{ border: '2px solid #EEE6E4', borderTopColor: 'var(--bid-primary)' }}
              />
              <div className="text-[11.5px] font-bold" style={{ color: 'var(--bid-ink-2)' }}>
                {t('parsing.title')}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {PARSE_STEPS.map((k, i) => {
                const done = i < parseStep
                const active = i === parseStep
                return (
                  <div
                    key={k}
                    className="flex items-center gap-2 text-[11px]"
                    style={{
                      color: done
                        ? 'var(--bid-success)'
                        : active
                          ? 'var(--bid-primary)'
                          : 'var(--bid-muted-3)',
                    }}
                  >
                    <span>{done ? '✓' : active ? '◐' : '○'}</span>
                    <span>{t(`parsingSteps.${k}`)}</span>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded" style={{ background: '#EEE6E4' }}>
              <div
                className="h-full rounded"
                style={{
                  width: `${((parseStep + 1) / PARSE_STEPS.length) * 100}%`,
                  background: 'var(--bid-primary)',
                  transition: 'width .4s',
                }}
              />
            </div>
          </div>
        )}

        {!parsing && (
          <div>
            <div className={`mb-2 ${sectionLabel}`} style={{ color: 'var(--bid-sub)' }}>
              {t('outline.stats')}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {stats.map(s => (
                <div
                  key={s.label}
                  className="rounded-[9px] px-2.5 py-2"
                  style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
                >
                  <div className="text-base font-extrabold" style={{ color: 'var(--bid-ink-2)' }}>
                    {s.value}
                  </div>
                  <div className="mt-px text-[10px]" style={{ color: 'var(--bid-muted-2)' }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!parsing && (
          <div>
            <div className={`mb-2 ${sectionLabel}`} style={{ color: 'var(--bid-sub)' }}>
              {t('outline.log')}
            </div>
            <div className="flex flex-col gap-2">
              {PARSE_STEPS.map((k, i) => (
                <div
                  key={k}
                  className="flex items-center gap-2 text-[11.5px]"
                  style={{ color: 'var(--bid-sub)' }}
                >
                  <span style={{ color: 'var(--bid-success)' }}>✓</span>
                  <span className="flex-1">{t(`outline.log_items.${k}`)}</span>
                  <span className="font-mono text-[10.5px]" style={{ color: 'var(--bid-muted-3)' }}>
                    00:0{i + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Center: mind-map canvas */}
      <div className="relative flex min-w-[480px] flex-1 flex-col">
        <div
          className="flex flex-shrink-0 items-center gap-2 overflow-x-auto px-4 py-2.5"
          style={{ borderBottom: '1px solid var(--bid-border)', background: '#fff' }}
        >
          <div
            className="flex-shrink-0 text-[12.5px] font-bold"
            style={{ color: 'var(--bid-sub)' }}
          >
            {t('outline.canvas')}
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('outline.search')}
            data-testid="bid-outline-search"
            className="w-[130px] flex-shrink-0 rounded-[7px] px-2.5 py-1.5 text-[11.5px] outline-none"
            style={{ border: '1px solid var(--bid-border)', background: '#fff' }}
          />
          <div className="min-w-2 flex-1" />
          {!parsing && (
            <>
              <span
                className={pill}
                onClick={() => setCollapsed(new Set())}
                style={{ background: 'var(--bid-paper)', color: 'var(--bid-sub)' }}
              >
                {t('outline.expand_all')}
              </span>
              <span
                className={pill}
                onClick={() => setCollapsed(new Set(sections.map(s => s.id ?? '').filter(Boolean)))}
                style={{ background: 'var(--bid-paper)', color: 'var(--bid-sub)' }}
              >
                {t('outline.collapse_all')}
              </span>
              <span
                className={pill}
                onClick={() => setZoom(1)}
                style={{ background: 'var(--bid-paper)', color: 'var(--bid-sub)' }}
              >
                ⟲ {t('outline.reset_view')}
              </span>
              <span
                className={pill}
                onClick={() => sections[0]?.id && addChild(sections[0].id)}
                data-testid="bid-outline-add-node"
                style={{ background: 'var(--bid-primary)', color: '#fff', fontWeight: 700 }}
              >
                ＋ {t('outline.add_node')}
              </span>
              <span
                title={t('outline.canvas_hint')}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px]"
                style={{
                  background: 'var(--bid-border)',
                  color: 'var(--bid-muted-2)',
                  cursor: 'default',
                }}
              >
                ⓘ
              </span>
            </>
          )}
        </div>

        <div
          className="min-h-0 flex-1 overflow-auto"
          style={{
            background:
              'radial-gradient(circle, rgba(20,16,14,.07) 1px, transparent 1.4px) 0 0/22px 22px, var(--bid-paper-2)',
          }}
        >
          {parsing && (
            <div
              className="absolute inset-0 flex flex-col gap-6 p-8"
              data-testid="bid-outline-skeleton"
            >
              {[0, 1, 2, 3].map(r => (
                <div key={r} className="flex items-center gap-8">
                  <div
                    className="h-11 w-[200px] flex-shrink-0 animate-pulse rounded-[10px]"
                    style={{ background: '#EDE6E1' }}
                  />
                  <div className="flex flex-col gap-2.5">
                    {[0, 1].map(c => (
                      <div
                        key={c}
                        className="h-9 w-[240px] animate-pulse rounded-[10px]"
                        style={{ background: '#F3EEEA' }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div
            style={{
              width: layout.width * zoom,
              height: layout.height * zoom,
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: layout.width,
                height: layout.height,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              <svg
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                  pointerEvents: 'none',
                }}
              >
                {layout.edges.map((e, i) => (
                  <path key={i} d={e.d} stroke={`${e.accent}88`} strokeWidth={1.6} fill="none" />
                ))}
              </svg>
              {layout.nodes.map(n => {
                const isChapter = n.kind === 'chapter'
                const isSel = selectedId === n.id
                return (
                  <div
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    onDoubleClick={() => {
                      setEditingId(n.id)
                      setDraft(n.title)
                    }}
                    className="group absolute flex items-center overflow-hidden"
                    style={{
                      left: n.x,
                      top: n.y,
                      width: n.w,
                      height: n.h,
                      padding: isChapter ? '0 10px 0 14px' : '0 10px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      background: isChapter ? `${n.accent}12` : '#fff',
                      border: isSel
                        ? `1.5px solid var(--bid-primary)`
                        : `1px solid ${isChapter ? `${n.accent}55` : 'var(--bid-border)'}`,
                      boxShadow: isSel ? '0 2px 8px rgba(199,16,42,.12)' : 'none',
                    }}
                  >
                    {isChapter && (
                      <span
                        className="absolute left-0 top-0 h-full w-1"
                        style={{ background: n.accent }}
                      />
                    )}
                    {isChapter && n.hasChildren && (
                      <span
                        onClick={e => {
                          e.stopPropagation()
                          toggleCollapse(n.id)
                        }}
                        className="mr-1.5 flex-shrink-0 text-[10px]"
                        style={{
                          color: n.accent,
                          transform: collapsed.has(n.id) ? 'none' : 'rotate(90deg)',
                          transition: 'transform .15s',
                          cursor: 'pointer',
                        }}
                      >
                        ▸
                      </span>
                    )}
                    {editingId === n.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => e.key === 'Enter' && commitRename()}
                        onClick={e => e.stopPropagation()}
                        className="min-w-0 flex-1 rounded-[5px] px-1.5 py-0.5 outline-none"
                        style={{
                          border: `1px solid var(--bid-primary)`,
                          fontSize: 13,
                          fontWeight: isChapter ? 700 : 400,
                          boxShadow: '0 0 0 2px var(--bid-primary-soft)',
                        }}
                      />
                    ) : (
                      <span
                        className="truncate"
                        style={{
                          fontSize: 13,
                          fontWeight: isChapter ? 700 : 400,
                          color: isChapter ? 'var(--bid-ink)' : 'var(--bid-ink-2)',
                        }}
                      >
                        {n.title}
                      </span>
                    )}
                    {n.hidden > 0 && (
                      <span
                        className="ml-1.5 flex-shrink-0 rounded-lg px-1.5 text-[10.5px]"
                        style={{ background: '#EDE7E3', color: 'var(--bid-muted)' }}
                      >
                        +{n.hidden}
                      </span>
                    )}
                    {n.covers.length > 0 && (
                      <span
                        className="ml-1.5 flex-shrink-0 rounded-lg px-1.5 text-[10px] font-semibold"
                        style={{
                          background: 'var(--bid-primary-soft)',
                          color: 'var(--bid-primary)',
                        }}
                      >
                        {n.covers.join('/')}
                      </span>
                    )}
                    <span className="flex-1" />
                    {isChapter ? (
                      <span
                        onClick={e => {
                          e.stopPropagation()
                          addChild(n.id)
                        }}
                        className="flex-shrink-0 rounded px-1.5 text-sm opacity-0 group-hover:opacity-100"
                        style={{ color: n.accent, cursor: 'pointer' }}
                        title={t('phase2.add_child')}
                      >
                        +
                      </span>
                    ) : (
                      <span
                        onClick={e => {
                          e.stopPropagation()
                          deleteNode(n.id)
                        }}
                        className="flex-shrink-0 rounded px-1.5 text-sm opacity-0 group-hover:opacity-100"
                        style={{ color: 'var(--bid-muted-2)', cursor: 'pointer' }}
                        title={t('phase2.delete')}
                      >
                        ×
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Zoom control */}
        <div
          className="absolute bottom-4 left-4 flex items-center gap-0.5 rounded-full px-2 py-1"
          style={{
            background: '#fff',
            border: '1px solid var(--bid-border)',
            boxShadow: '0 6px 18px rgba(0,0,0,.08)',
          }}
        >
          <span
            onClick={() => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)))}
            className="flex h-6 w-6 items-center justify-center rounded-full text-sm"
            style={{ color: 'var(--bid-sub)', cursor: 'pointer' }}
          >
            －
          </span>
          <span
            onClick={() => setZoom(1)}
            className="w-11 text-center text-[11.5px]"
            style={{ color: 'var(--bid-sub)', cursor: 'pointer' }}
          >
            {Math.round(zoom * 100)}%
          </span>
          <span
            onClick={() => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(2)))}
            className="flex h-6 w-6 items-center justify-center rounded-full text-sm"
            style={{ color: 'var(--bid-sub)', cursor: 'pointer' }}
          >
            ＋
          </span>
        </div>

        {/* Minimap (static overview) */}
        <div
          className="absolute bottom-4 right-4 flex h-[100px] w-[150px] flex-col justify-center gap-1 rounded-[10px] p-2"
          style={{
            background: '#fffdfc',
            border: '1px solid var(--bid-border)',
            boxShadow: '0 6px 18px rgba(0,0,0,.08)',
          }}
        >
          {sections.slice(0, 6).map((s, i) => (
            <div
              key={s.id ?? i}
              className="h-1.5 rounded-full"
              style={{
                width: `${40 + (s.children?.length ?? 0) * 12}%`,
                maxWidth: '100%',
                background: `${ACCENTS[i % ACCENTS.length]}66`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Right: node detail / suggestions / change log */}
      <div
        className={sideCol}
        style={{
          width: 296,
          borderLeft: '1px solid var(--bid-border)',
          background: 'var(--bid-paper-2)',
        }}
      >
        <div>
          <div className={`mb-2 ${sectionLabel}`} style={{ color: 'var(--bid-sub)' }}>
            {t('outline.node_detail')}
          </div>
          {selected.node ? (
            <div
              className="flex flex-col gap-2 rounded-[10px] p-3"
              style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
            >
              <Row k={t('outline.detail_name')} v={selected.node.title || '—'} />
              <Row
                k={t('outline.detail_type')}
                v={
                  selected.node.children?.length
                    ? t('outline.type_chapter')
                    : t('outline.type_leaf')
                }
              />
              <Row k={t('outline.detail_parent')} v={selected.parent?.title || t('outline.root')} />
              <Row
                k={t('outline.detail_words')}
                v={t('outline.words_hint', {
                  n: selected.node.children?.length ? '1200–1800' : '600–1000',
                })}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
                  {t('outline.detail_priority')}
                </span>
                <span className="text-[12px]" style={{ color: '#E8A93C' }}>
                  {(selected.node.covers?.length ?? 0) > 0
                    ? '★★★'
                    : selected.node.children?.length
                      ? '★★☆'
                      : '★☆☆'}
                </span>
              </div>
            </div>
          ) : (
            <div
              className="rounded-[10px] p-5 text-center text-[11.5px]"
              style={{ border: '1px dashed var(--bid-border)', color: 'var(--bid-muted-3)' }}
            >
              {t('outline.pick_node')}
            </div>
          )}
        </div>

        {!parsing && (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className={sectionLabel} style={{ color: 'var(--bid-sub)' }}>
                  {t('outline.suggestions')}
                </div>
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px]"
                  style={{ background: 'var(--bid-primary-soft)', color: 'var(--bid-primary)' }}
                >
                  {t('outline.ai_badge')}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {suggestions.length === 0 ? (
                  <div
                    className="rounded-[10px] p-3 text-[11.5px]"
                    style={{ background: 'var(--bid-success-soft)', color: 'var(--bid-success)' }}
                  >
                    {t('outline.coverage_ok')} · {cov.covered}/{cov.total}
                  </div>
                ) : (
                  suggestions.map(s => (
                    <div
                      key={s.id}
                      className="rounded-[10px] p-2.5"
                      style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
                    >
                      <div
                        className="mb-0.5 text-[11.5px] font-bold"
                        style={{ color: 'var(--bid-ink-2)' }}
                      >
                        {t(
                          s.kind === 'scoring'
                            ? 'outline.uncovered_scoring'
                            : 'outline.uncovered_clause'
                        )}
                      </div>
                      <div className="mb-2 text-[11px]" style={{ color: 'var(--bid-muted)' }}>
                        {s.id}
                      </div>
                      <div className="flex gap-2">
                        <span
                          onClick={() => acceptSuggestion(s.id)}
                          className="rounded-md px-2.5 py-1 text-[11px] text-white"
                          style={{ background: 'var(--bid-primary)', cursor: 'pointer' }}
                        >
                          {t('outline.accept')}
                        </span>
                        <span
                          onClick={() => setDismissed(prev => new Set(prev).add(s.id))}
                          className="px-1 py-1 text-[11px]"
                          style={{ color: 'var(--bid-muted-2)', cursor: 'pointer' }}
                        >
                          {t('outline.dismiss')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <div className={`mb-2 ${sectionLabel}`} style={{ color: 'var(--bid-sub)' }}>
                {t('outline.changelog')}
              </div>
              <div className="flex flex-col gap-2">
                {edits > 0 && (
                  <ChangeItem
                    color="var(--bid-primary)"
                    v={`v1.${edits}`}
                    label={t('phase2.title')}
                    who={t('projects.owner_role')}
                    time="刚刚"
                  />
                )}
                <ChangeItem
                  color="var(--bid-success)"
                  v="v1.0"
                  label={t('outline.changelog_build')}
                  who="拆标神探"
                  time="00:04"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
        {k}
      </span>
      <span className="text-right text-[11.5px]" style={{ color: 'var(--bid-ink-2)' }}>
        {v}
      </span>
    </div>
  )
}

function ChangeItem({
  color,
  v,
  label,
  who,
  time,
}: {
  color: string
  v: string
  label: string
  who: string
  time: string
}) {
  return (
    <div className="pl-2.5" style={{ borderLeft: `2px solid ${color}` }}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] font-bold" style={{ color }}>
          {v}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--bid-ink-2)' }}>
          {label}
        </span>
      </div>
      <div className="mt-px text-[10.5px]" style={{ color: 'var(--bid-muted-3)' }}>
        {who} · {time}
      </div>
    </div>
  )
}
