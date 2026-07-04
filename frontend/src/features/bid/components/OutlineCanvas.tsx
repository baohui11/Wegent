// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import type { CoverageReport, LlmCall, OutlineDoc } from '@/apis/bid'
import { ParsedCallView } from './ParsedCallView'
import { useOutlineCanvas } from '../canvas/useOutlineCanvas'
import {
  chapterColor,
  childrenOf,
  genNodeId,
  type FlatNode,
  type Layout,
} from '../canvas/outlineGraph'
import type { Viewport } from '../canvas/useOutlineCanvas'

// Real backend parse stages (set_parse_stage): the canvas shows which one is
// actually running, driven by GET /parse-stage — not a fake timer.
const PARSE_STEPS = ['segmenting', 'extracting', 'merging', 'building_outline'] as const

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Map backend specialist names to display labels (keys live in i18n).
const SPECIALIST_LABEL_KEY: Record<string, string> = {
  tender_sleuth: 'outline.specialist_sleuth',
  ghostwriter: 'outline.specialist_ghostwriter',
  fact_checker: 'outline.specialist_factchecker',
}

// Tender blocks the sleuth extracts (call.label). Each has a friendly i18n name
// under outline.block.* so parse-log rows read "评分办法" instead of a repeated
// specialist name with the block truncated off.
const BLOCK_KEYS = new Set([
  'project',
  'qualifications',
  'scoring',
  'mandatory_clauses',
  'target_package',
  'submission_rules',
  'required_outline',
  'requirements',
  'commitment_terms',
  'derived_outline',
])

export function OutlineCanvas({
  outline,
  coverage,
  title,
  onSave,
  parsing = false,
  parseStage,
  llmLog,
  fileSize,
}: {
  outline?: OutlineDoc
  coverage?: CoverageReport
  title: string
  onSave?: (o: OutlineDoc) => void
  // When true, the tender is still being parsed: the left column shows the
  // parse-progress card and the canvas shows a skeleton (design's in-canvas
  // parsing state) instead of the populated outline.
  parsing?: boolean
  // Current real backend parse stage from GET /parse-stage (segmenting /
  // extracting / merging / building_outline / done / failed). Drives which
  // step is active; absent -> assume the first step.
  parseStage?: string
  // Real LLM call log from GET /llm-log (B3); drives the left "parse log" panel.
  llmLog?: LlmCall[]
  // Real tender file size in bytes; falls back to '—' when unknown.
  fileSize?: number
}) {
  const { t } = useTranslation('bidWorkbench')
  const cov = coverage ?? { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] }
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // Which real LLM call's full response is expanded in the parse-log feed.
  const [expandedCall, setExpandedCall] = useState<number | null>(null)

  const c = useOutlineCanvas(outline, onSave, {
    chapter: t('outline.new_chapter'),
    node: t('phase2.new_node'),
  })

  // Which step is active = index of the real backend stage. 'done'/absent map
  // past the last step (all complete); 'failed' is surfaced separately below.
  const parseFailed = parseStage === 'failed'
  const stageIdx = PARSE_STEPS.indexOf(parseStage as (typeof PARSE_STEPS)[number])
  const parseStep = parseStage === 'done' ? PARSE_STEPS.length : stageIdx < 0 ? 0 : stageIdx

  const stats = useMemo(() => {
    const { flat, layout } = c
    const depthOf = (id: string) => layout.pos[id]?.depth ?? 0
    const l2 = flat.filter(n => depthOf(n.id) === 1).length
    const l3 = flat.filter(n => depthOf(n.id) === 2).length
    const leaves = flat.filter(n => !flat.some(x => x.parentId === n.id)).length
    return [
      { value: childrenOf(flat, null).length, label: t('outline.chapters') },
      { value: l2, label: t('outline.level2') },
      { value: l3, label: t('outline.level3') },
      { value: leaves, label: t('outline.leaves') },
      { value: cov.total, label: t('outline.scoring_points') },
    ]
  }, [c, cov.total, t])

  const acceptSuggestion = (item: { id: string; text: string; targetSection?: string }) => {
    // Route the new section under the chapter whose title matches the item's
    // target_section; fall back to the first chapter when no match. The new
    // node is named after the real content, never the internal id.
    const chapters = childrenOf(c.flat, null)
    const lower = (item.targetSection ?? '').trim().toLowerCase()
    const match = lower
      ? chapters.find(ch => {
          const name = (ch.name ?? '').trim().toLowerCase()
          return name === lower || (name && lower.includes(name)) || name.includes(lower)
        })
      : undefined
    const parent = match ?? chapters[0]
    if (parent) {
      const siblings = childrenOf(c.flat, parent.id)
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order), -1)
      const name = item.text ? item.text.slice(0, 40) : t('outline.new_chapter')
      c.commit([
        ...c.flat,
        { id: genNodeId(), parentId: parent.id, order: maxOrder + 1, name, covers: [item.id] },
      ])
    }
    setDismissed(prev => new Set(prev).add(item.id))
  }

  const sectionLabel = 'text-xs font-extrabold'
  const sideCol = 'flex flex-shrink-0 flex-col gap-4 overflow-auto p-4'
  const pill =
    'flex-shrink-0 whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[11.5px] cursor-pointer'

  const suggestions = [
    ...cov.uncovered_scoring
      .filter(u => !dismissed.has(u.id))
      .map(u => ({ ...u, kind: 'scoring' as const })),
    ...cov.uncovered_clauses
      .filter(u => !dismissed.has(u.id))
      .map(u => ({ ...u, kind: 'clause' as const })),
  ]

  const searchLower = c.search.trim().toLowerCase()

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
                {fileSize != null ? fmtBytes(fileSize) : '—'} ·{' '}
                {parseFailed ? (
                  <span style={{ color: '#B3453D' }}>✕ {t('outline.parse_failed')}</span>
                ) : parsing ? (
                  <span style={{ color: 'var(--bid-primary)' }}>◐ {t('outline.parsing_now')}</span>
                ) : (
                  <span style={{ color: 'var(--bid-success)' }}>✓ {t('outline.parsed_ok')}</span>
                )}
              </div>
            </div>
          </div>
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

        {/* Real specialist-call feed — shown while parsing (calls land live) and
            after (as the record). Each row expands to the model's real output. */}
        <div>
          <div className={`mb-2 ${sectionLabel}`} style={{ color: 'var(--bid-sub)' }}>
            {t('outline.log')}
          </div>
          <div className="flex flex-col gap-2">
            {(llmLog ?? []).length === 0 ? (
              <div
                className="rounded-[10px] p-3 text-[11.5px]"
                style={{
                  background: '#fff',
                  border: '1px solid var(--bid-border)',
                  color: 'var(--bid-muted-3)',
                }}
              >
                {parsing ? t('outline.log_running') : t('outline.log_empty')}
              </div>
            ) : (
              (llmLog ?? []).map(call => {
                const labelKey = SPECIALIST_LABEL_KEY[call.specialist] ?? 'outline.specialist_other'
                // Lead with the differentiating info: the friendly block name
                // (sleuth) or the section title (ghostwriter); the specialist is
                // the same for every row, so keep it as a small trailing tag.
                const displayName = BLOCK_KEYS.has(call.label)
                  ? t(`outline.block.${call.label}`)
                  : call.label || t(labelKey)
                const expanded = expandedCall === call.id
                return (
                  <div
                    key={call.id}
                    className="rounded-[9px]"
                    style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
                  >
                    <div
                      onClick={() => setExpandedCall(expanded ? null : call.id)}
                      data-testid="bid-llm-call-row"
                      className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-[11.5px]"
                      style={{ color: 'var(--bid-sub)' }}
                    >
                      <span
                        style={{ color: call.status === 'ok' ? 'var(--bid-success)' : '#B3453D' }}
                      >
                        {call.status === 'ok' ? '✓' : '✕'}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate font-semibold"
                        style={{ color: 'var(--bid-ink-2)' }}
                      >
                        {displayName}
                      </span>
                      <span
                        className="flex-shrink-0 font-mono text-[10.5px]"
                        style={{ color: 'var(--bid-muted-3)' }}
                      >
                        {(call.prompt_tokens + call.completion_tokens).toLocaleString()}t ·{' '}
                        {(call.duration_ms / 1000).toFixed(1)}s
                      </span>
                      <span className="flex-shrink-0 text-[9px]" style={{ opacity: 0.5 }}>
                        {expanded ? '▲' : '▼'}
                      </span>
                    </div>
                    {expanded && (
                      <div className="px-2.5 pb-2.5">
                        <ParsedCallView response={call.response} label={call.label} />
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Center: interactive mind-map canvas */}
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
            value={c.search}
            onChange={e => c.setSearch(e.target.value)}
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
                onClick={c.expandAll}
                style={{ background: 'var(--bid-paper)', color: 'var(--bid-sub)' }}
              >
                {t('outline.expand_all')}
              </span>
              <span
                className={pill}
                onClick={c.collapseAll}
                style={{ background: 'var(--bid-paper)', color: 'var(--bid-sub)' }}
              >
                {t('outline.collapse_all')}
              </span>
              <span
                className={pill}
                onClick={c.resetView}
                style={{ background: 'var(--bid-paper)', color: 'var(--bid-sub)' }}
              >
                ⟲ {t('outline.reset_view')}
              </span>
              <span
                className={pill}
                onClick={c.addNodeSmart}
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
          ref={c.scrollRef}
          onScroll={c.syncViewport}
          className="relative min-h-0 flex-1 overflow-auto"
          style={{
            background:
              'radial-gradient(circle, rgba(20,16,14,.08) 1px, transparent 1.4px) 0 0/22px 22px, var(--bid-paper-2)',
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
                    {[0, 1].map(col => (
                      <div
                        key={col}
                        className="h-9 w-[240px] animate-pulse rounded-[10px]"
                        style={{ background: '#F3EEEA' }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!parsing && (
            <div
              ref={c.canvasRef}
              onMouseDown={c.onCanvasMouseDown}
              data-testid="bid-outline-canvas"
              style={{ position: 'relative', width: c.layout.width, height: c.layout.height }}
            >
              <svg
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                  pointerEvents: 'none',
                }}
              >
                {c.edges.map(e => (
                  <path
                    key={e.id}
                    d={e.d}
                    stroke={e.stroke}
                    strokeWidth={e.strokeWidth}
                    fill="none"
                  />
                ))}
                {/* Snap-preview edge: the connection that forms on drop. */}
                {c.dropHint?.kind === 'reparent' && (
                  <path
                    data-testid="bid-outline-snap-edge"
                    d={c.dropHint.edge}
                    stroke="var(--bid-primary)"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    fill="none"
                  />
                )}
              </svg>

              {/* Landing-slot placeholder: where the dragged node will sit. */}
              {c.dropHint?.kind === 'reparent' && (
                <div
                  data-testid="bid-outline-drop-ghost"
                  style={{
                    position: 'absolute',
                    left: c.dropHint.ghostX,
                    top: c.dropHint.ghostY,
                    width: c.layout.NW,
                    height: c.layout.NH,
                    borderRadius: 10,
                    border: '2px dashed var(--bid-primary)',
                    background: 'rgba(199,16,42,.06)',
                    pointerEvents: 'none',
                    zIndex: 44,
                  }}
                />
              )}

              {c.flat.map(n => (
                <CanvasNode key={n.id} node={n} canvas={c} searchLower={searchLower} />
              ))}

              {/* Insertion indicator: where a reorder-drop will land the node. */}
              {c.dropHint?.kind === 'reorder' && (
                <div
                  data-testid="bid-outline-insert-line"
                  style={{
                    position: 'absolute',
                    left: c.dropHint.lineX,
                    top: c.dropHint.lineY,
                    width: c.dropHint.lineW,
                    height: 3,
                    borderRadius: 2,
                    background: 'var(--bid-primary)',
                    boxShadow: '0 0 0 4px rgba(199,16,42,.14)',
                    pointerEvents: 'none',
                    zIndex: 45,
                  }}
                />
              )}

              {c.marquee && (
                <div
                  style={{
                    position: 'absolute',
                    left: Math.min(c.marquee.x0, c.marquee.x1),
                    top: Math.min(c.marquee.y0, c.marquee.y1),
                    width: Math.abs(c.marquee.x1 - c.marquee.x0),
                    height: Math.abs(c.marquee.y1 - c.marquee.y0),
                    background: 'rgba(199,16,42,.08)',
                    border: '1px solid rgba(199,16,42,.53)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* Zoom control */}
        {!parsing && (
          <div
            className="absolute bottom-4 left-4 flex items-center gap-0.5 rounded-full px-2 py-1"
            style={{
              background: '#fff',
              border: '1px solid var(--bid-border)',
              boxShadow: '0 6px 18px rgba(0,0,0,.08)',
            }}
          >
            <span
              onClick={c.zoomOut}
              className="flex h-6 w-6 items-center justify-center rounded-full text-sm"
              style={{ color: 'var(--bid-sub)', cursor: 'pointer' }}
            >
              －
            </span>
            <span
              onClick={c.zoomReset}
              className="w-11 text-center text-[11.5px]"
              style={{ color: 'var(--bid-sub)', cursor: 'pointer' }}
            >
              {Math.round(c.zoom * 100)}%
            </span>
            <span
              onClick={c.zoomIn}
              className="flex h-6 w-6 items-center justify-center rounded-full text-sm"
              style={{ color: 'var(--bid-sub)', cursor: 'pointer' }}
            >
              ＋
            </span>
          </div>
        )}

        {/* Live minimap */}
        {!parsing && (
          <Minimap
            flat={c.flat}
            layout={c.layout}
            viewport={c.viewport}
            panTo={c.panTo}
            label={t('outline.minimap')}
          />
        )}
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
          {c.selected.node ? (
            <div
              className="flex flex-col gap-2 rounded-[10px] p-3"
              style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
            >
              <Row k={t('outline.detail_name')} v={c.selected.node.name || '—'} />
              <Row
                k={t('outline.detail_type')}
                v={c.selected.hasChildren ? t('outline.type_chapter') : t('outline.type_leaf')}
              />
              <Row
                k={t('outline.detail_parent')}
                v={c.selected.parent?.name || t('outline.root')}
              />
              <Row
                k={t('outline.detail_words')}
                v={`${t('outline.words_hint', {
                  n: c.selected.hasChildren ? '1200–1800' : '600–1000',
                })}${t('outline.estimate_suffix')}`}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
                  {t('outline.detail_priority')}
                  <span className="ml-1 text-[9.5px]" style={{ color: 'var(--bid-muted-3)' }}>
                    {t('outline.estimate_suffix')}
                  </span>
                </span>
                <span className="text-[12px]" style={{ color: '#E8A93C' }}>
                  {(c.selected.node.covers?.length ?? 0) > 0
                    ? '★★★'
                    : c.selected.hasChildren
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
                  style={{ background: 'var(--bid-surface)', color: 'var(--bid-muted-2)' }}
                >
                  {t('outline.coverage_badge')}
                </span>
              </div>
              <div className="mb-2 text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
                {t('outline.suggestions_hint')}
              </div>
              <div className="flex flex-col gap-2">
                {suggestions.length === 0 ? (
                  cov.covered >= cov.total ? (
                    <div
                      className="rounded-[10px] p-3 text-[11.5px]"
                      style={{ background: 'var(--bid-success-soft)', color: 'var(--bid-success)' }}
                    >
                      {t('outline.coverage_ok')} · {cov.covered}/{cov.total}
                    </div>
                  ) : (
                    // Suggestions were dismissed, not covered — don't claim "all covered".
                    <div
                      className="rounded-[10px] p-3 text-[11.5px]"
                      style={{ background: 'var(--bid-surface)', color: 'var(--bid-muted-2)' }}
                    >
                      {t('outline.coverage_partial', { covered: cov.covered, total: cov.total })}
                    </div>
                  )
                ) : (
                  suggestions.map(s => (
                    <div
                      key={s.id}
                      className="rounded-[10px] p-2.5"
                      style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <span
                          className="rounded px-1 py-px text-[9.5px] font-bold"
                          style={
                            s.kind === 'clause'
                              ? { background: '#F6E0DE', color: '#B3453D' }
                              : {
                                  background: 'var(--bid-primary-soft)',
                                  color: 'var(--bid-primary)',
                                }
                          }
                        >
                          {t(
                            s.kind === 'scoring'
                              ? 'outline.uncovered_scoring'
                              : 'outline.uncovered_clause'
                          )}
                        </span>
                      </div>
                      <div
                        className="mb-2 text-[11.5px] leading-snug"
                        style={{ color: 'var(--bid-ink-2)' }}
                      >
                        {s.text || t('outline.uncovered_no_text')}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() =>
                            acceptSuggestion({
                              id: s.id,
                              text: s.text,
                              targetSection: s.target_section,
                            })
                          }
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
                {c.edits > 0 && (
                  <ChangeItem
                    color="var(--bid-primary)"
                    v={`v1.${c.edits}`}
                    label={t('outline.changelog_edit')}
                  />
                )}
                <ChangeItem
                  color="var(--bid-success)"
                  v="v1.0"
                  label={t('outline.changelog_build')}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      {c.confirmDeleteId && (
        <div
          className="absolute inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(30,26,24,.25)' }}
          onClick={c.cancelDelete}
          data-testid="bid-outline-delete-confirm"
        >
          <div
            className="w-[320px] rounded-[14px] p-6"
            style={{ background: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-2 text-[14.5px] font-bold" style={{ color: 'var(--bid-ink)' }}>
              {t('outline.delete_title')}
            </div>
            <div className="mb-[18px] text-[12.5px]" style={{ color: 'var(--bid-muted)' }}>
              {t('outline.delete_desc', { name: c.confirmDeleteName })}
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={c.cancelDelete}
                className="rounded-lg px-4 py-2 text-[12.5px]"
                style={{
                  background: 'var(--bid-paper)',
                  color: 'var(--bid-sub)',
                  cursor: 'pointer',
                }}
              >
                {t('outline.delete_cancel')}
              </button>
              <button
                type="button"
                onClick={c.confirmDelete}
                data-testid="bid-outline-delete-confirm-btn"
                className="rounded-lg px-4 py-2 text-[12.5px] text-white"
                style={{ background: '#B3453D', cursor: 'pointer' }}
              >
                {t('outline.delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type CanvasApi = ReturnType<typeof useOutlineCanvas>

function CanvasNode({
  node,
  canvas: c,
  searchLower,
}: {
  node: FlatNode
  canvas: CanvasApi
  searchLower: string
}) {
  const { t } = useTranslation('bidWorkbench')
  const p = c.layout.pos[node.id]
  if (!p) return null

  const isChapter = !node.parentId
  const hasChildren = c.flat.some(x => x.parentId === node.id)
  const isCollapsed = c.collapsed.has(node.id)
  const hiddenCount = isCollapsed ? c.countDescendants(node.id) : 0
  const isSelected = c.selectedId === node.id || c.selectedIds.includes(node.id)
  const isDragging = c.drag?.id === node.id
  const isEditing = c.editingId === node.id
  const isMatch = searchLower.length > 0 && node.name.toLowerCase().includes(searchLower)
  const isDropTarget = c.dropHint?.kind === 'reparent' && c.dropHint.targetId === node.id
  const accent = chapterColor(c.flat, node.id)
  const { NW, NH, zoom } = c.layout

  const boxShadow = isDropTarget
    ? `0 0 0 3px var(--bid-primary), 0 6px 18px rgba(199,16,42,.22)`
    : isDragging
      ? `0 8px 24px rgba(20,16,14,.22)`
      : isSelected
        ? `0 0 0 3px ${accent}44, 0 4px 12px rgba(20,16,14,.1)`
        : isMatch
          ? '0 0 0 2px #E8A93C'
          : '0 1px 2px rgba(20,16,14,0.06)'

  return (
    <div
      data-testid="bid-outline-node"
      onMouseDown={e => c.onNodeMouseDown(node.id, e)}
      onDoubleClick={() => c.startEditing(node.id)}
      title={node.name}
      className="group flex items-center"
      style={{
        position: 'absolute',
        left: p.x,
        top: p.y,
        width: NW,
        height: NH,
        transform: isDragging ? `translate(${c.drag!.dx}px,${c.drag!.dy}px)` : undefined,
        background: isChapter ? `${accent}14` : '#fff',
        border: `1.5px solid ${isChapter ? accent : `${accent}66`}`,
        borderRadius: 10,
        color: isChapter ? accent : 'var(--bid-ink-2)',
        padding: `0 ${Math.round(10 * zoom)}px 0 ${Math.round((isChapter ? 14 : 10) * zoom)}px`,
        fontWeight: isChapter ? 700 : 500,
        cursor: isDragging ? 'grabbing' : 'grab',
        boxShadow,
        opacity: isDragging ? 0.92 : 1,
        // Settle animation: non-dragging nodes ease to their new layout slot so
        // the tree reflows smoothly after a drop instead of snapping.
        transition: isDragging
          ? 'none'
          : 'left .18s ease, top .18s ease, box-shadow .15s, border-color .15s',
        zIndex: isDragging ? 50 : isDropTarget ? 40 : isChapter ? 2 : 1,
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {isChapter && (
        <span
          className="absolute left-0"
          style={{ top: 8, bottom: 8, width: 3, borderRadius: 2, background: accent }}
        />
      )}
      {hasChildren && (
        <span
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            c.toggleCollapse(node.id)
          }}
          className="mr-1.5 flex-shrink-0 text-[10px]"
          style={{
            color: 'inherit',
            opacity: 0.6,
            transform: isCollapsed ? 'none' : 'rotate(90deg)',
            transition: 'transform .15s',
            cursor: 'pointer',
          }}
        >
          ▸
        </span>
      )}
      {isEditing ? (
        <input
          autoFocus
          value={c.editingValue}
          onChange={e => c.setEditingValue(e.target.value)}
          onBlur={c.commitEditing}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          onMouseDown={e => e.stopPropagation()}
          className="min-w-0 flex-1 rounded-[5px] px-1.5 py-0.5 outline-none"
          style={{
            border: '1px solid var(--bid-primary)',
            fontSize: Math.round(13 * zoom),
            fontWeight: 'inherit',
            color: 'inherit',
            background: '#fff',
            boxShadow: '0 0 0 2px var(--bid-primary-soft)',
          }}
        />
      ) : (
        <span
          className="line-clamp-2 min-w-0 flex-1 leading-tight"
          style={{ fontSize: Math.round(13 * zoom) }}
        >
          {node.name}
        </span>
      )}
      {isCollapsed && hiddenCount > 0 && (
        <span
          className="ml-1.5 flex-shrink-0 rounded-lg px-1.5 text-[10.5px]"
          style={{ background: '#EDE7E3', color: 'var(--bid-muted)' }}
        >
          +{hiddenCount}
        </span>
      )}
      {node.covers.length > 0 && (
        // A covered node gets a small dot, not the raw internal id (MC-001…).
        <span
          title={t('outline.covers_indicator', { count: node.covers.length })}
          className="ml-1.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
          style={{ background: 'var(--bid-primary-soft)', color: 'var(--bid-primary)' }}
        >
          ✓
        </span>
      )}
      {!isEditing && (
        <>
          <span
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              c.addChild(node.id)
            }}
            title={t('phase2.add_child')}
            className="ml-1.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] text-xs opacity-0 group-hover:opacity-100"
            style={{ background: '#F1EEEB', color: 'var(--bid-sub)', cursor: 'pointer' }}
          >
            +
          </span>
          <span
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              c.requestDelete(node.id)
            }}
            title={t('phase2.delete')}
            className="ml-1 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] text-xs opacity-0 group-hover:opacity-100"
            style={{ background: '#F1EEEB', color: '#B3453D', cursor: 'pointer' }}
          >
            ×
          </span>
        </>
      )}
    </div>
  )
}

function Minimap({
  flat,
  layout,
  viewport,
  panTo,
  label,
}: {
  flat: FlatNode[]
  layout: Layout
  viewport: Viewport
  panTo: (cx: number, cy: number) => void
  label: string
}) {
  const PAD = 8
  const boxW = 150
  const boxH = 100
  const innerW = boxW - PAD * 2
  const innerH = boxH - PAD * 2
  const scale = Math.min(innerW / Math.max(layout.width, 1), innerH / Math.max(layout.height, 1))

  const handlePan = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left - PAD) / scale
    const y = (e.clientY - rect.top - PAD) / scale
    panTo(x, y)
  }

  return (
    <div
      data-testid="bid-outline-minimap"
      title={label}
      onMouseDown={handlePan}
      className="absolute bottom-4 right-4"
      style={{
        width: boxW,
        height: boxH,
        background: '#fffdfc',
        border: '1px solid var(--bid-border)',
        borderRadius: 10,
        boxShadow: '0 6px 18px rgba(0,0,0,.08)',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', inset: PAD }}>
        {flat.map(n => {
          const p = layout.pos[n.id]
          if (!p) return null
          const isChapter = !n.parentId
          const accent = chapterColor(flat, n.id)
          return (
            <div
              key={n.id}
              style={{
                position: 'absolute',
                left: p.x * scale,
                top: p.y * scale,
                width: Math.max(layout.NW * scale, 2),
                height: Math.max(layout.NH * scale, 1.5),
                borderRadius: 1.5,
                background: accent,
                opacity: isChapter ? 0.85 : 0.4,
              }}
            />
          )
        })}
        {/* Viewport indicator */}
        <div
          style={{
            position: 'absolute',
            left: viewport.left * scale,
            top: viewport.top * scale,
            width: viewport.w * scale,
            height: viewport.h * scale,
            border: '1.5px solid var(--bid-primary)',
            borderRadius: 2,
            background: 'rgba(199,16,42,.06)',
            pointerEvents: 'none',
          }}
        />
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

function ChangeItem({ color, v, label }: { color: string; v: string; label: string }) {
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
    </div>
  )
}
