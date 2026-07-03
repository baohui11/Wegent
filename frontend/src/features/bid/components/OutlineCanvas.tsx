// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import type { CoverageReport, OutlineDoc, OutlineNode } from '@/apis/bid'

// Chapter accent colours cycled across top-level sections (mockup palette).
const ACCENTS = ['#C7102A', '#C77700', '#1E8E5A', '#8E2140', '#A3121A', '#57524D']

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

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <div
      className="rounded-[9px] px-2.5 py-2"
      style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
    >
      <div className="text-base font-extrabold" style={{ color: 'var(--bid-ink-2)' }}>
        {value}
      </div>
      <div className="mt-px text-[10px]" style={{ color: 'var(--bid-muted-2)' }}>
        {label}
      </div>
    </div>
  )
}

export function OutlineCanvas({
  outline,
  coverage,
  title,
  onSave,
  onNext,
}: {
  outline: OutlineDoc
  coverage: CoverageReport
  title: string
  onSave: (o: OutlineDoc) => void
  onNext: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const sections = useMemo(() => outline.sections ?? [], [outline.sections])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')

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
    ]
  }, [sections, t])

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

  const commitRename = () => {
    if (!editingId) return
    const id = editingId
    const value = draft.trim()
    setEditingId(null)
    if (value)
      onSave({
        ...outline,
        sections: mapTree(sections, n => (n.id === id ? { ...n, title: value } : n)),
      })
  }

  const deleteNode = (id: string) => onSave({ ...outline, sections: removeNode(sections, id) })

  const matches = (name: string) => !search || (name || '').includes(search)

  return (
    <div className="flex h-full overflow-x-auto" data-testid="bid-outline-editor">
      {/* Left: file / stats / log */}
      <div
        className="flex w-[272px] flex-shrink-0 flex-col gap-4 overflow-auto p-4"
        style={{ borderRight: '1px solid var(--bid-border)', background: 'var(--bid-paper-2)' }}
      >
        <div>
          <div className="mb-2 text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
            {t('outline.tender_file')}
          </div>
          <div
            className="flex items-center gap-2.5 rounded-[10px] p-3"
            style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
          >
            <div
              className="flex h-[34px] w-[30px] flex-shrink-0 items-center justify-center rounded-[5px] text-sm"
              style={{ background: 'var(--bid-primary-soft)' }}
            >
              📄
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[11.5px] font-bold"
                style={{ color: 'var(--bid-ink-2)' }}
              >
                {title}
              </div>
              <div className="mt-0.5 text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
                <span style={{ color: 'var(--bid-success)' }}>✓ {t('outline.parsed_ok')}</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
            {t('outline.stats')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {stats.map(s => (
              <StatCard key={s.label} value={s.value} label={s.label} />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
            {t('outline.log')}
          </div>
          <div className="flex flex-col gap-2">
            {(['ocr', 'toc', 'classify', 'tree'] as const).map(k => (
              <div
                key={k}
                className="flex items-center gap-2 text-[11.5px]"
                style={{ color: 'var(--bid-sub)' }}
              >
                <span style={{ color: 'var(--bid-success)' }}>✓</span>
                <span className="flex-1">{t(`parsingSteps.${k}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Center: outline canvas */}
      <div className="flex min-w-[480px] flex-1 flex-col">
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
            className="w-[140px] flex-shrink-0 rounded-[7px] px-2.5 py-1.5 text-[11.5px] outline-none"
            style={{ border: '1px solid var(--bid-border)' }}
          />
          <div className="min-w-2 flex-1" />
          <button
            type="button"
            onClick={onNext}
            data-testid="outline-next-button"
            className="flex-shrink-0 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[11.5px] font-bold text-white"
            style={{ background: 'var(--bid-primary)' }}
          >
            {t('outline.confirm')}
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-auto p-6"
          style={{
            background:
              'radial-gradient(circle, rgba(20,16,14,.06) 1px, transparent 1.4px) 0 0/22px 22px, var(--bid-paper-2)',
          }}
        >
          <div className="flex flex-col gap-5">
            {sections
              .filter(
                c => matches(c.title || '') || (c.children || []).some(l => matches(l.title || ''))
              )
              .map((chapter, ci) => {
                const accent = ACCENTS[ci % ACCENTS.length]
                const leaves = chapter.children ?? []
                return (
                  <div key={chapter.id ?? ci} className="flex items-start gap-0">
                    {/* Chapter card */}
                    <div
                      onClick={() => setSelectedId(chapter.id ?? null)}
                      onDoubleClick={() => {
                        setEditingId(chapter.id ?? null)
                        setDraft(chapter.title || '')
                      }}
                      className="relative flex w-[230px] flex-shrink-0 cursor-pointer items-center overflow-hidden rounded-[10px] px-3 py-2.5"
                      style={{
                        background: `${accent}10`,
                        border: `1px solid ${accent}55`,
                      }}
                    >
                      <span
                        className="absolute left-0 top-0 h-full w-1"
                        style={{ background: accent }}
                      />
                      {editingId === chapter.id ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={e => setDraft(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={e => e.key === 'Enter' && commitRename()}
                          className="ml-1.5 flex-1 rounded-[5px] px-1.5 py-0.5 text-[13px] font-bold outline-none"
                          style={{ border: `1px solid ${accent}` }}
                        />
                      ) : (
                        <span
                          className="ml-1.5 text-[13px] font-bold"
                          style={{ color: 'var(--bid-ink)' }}
                        >
                          {chapter.title}
                        </span>
                      )}
                    </div>

                    {/* Connector + leaves */}
                    {leaves.length > 0 && (
                      <>
                        <div className="w-8 flex-shrink-0 self-stretch" aria-hidden>
                          <div className="ml-0 h-full" style={{ borderBottom: 'none' }} />
                        </div>
                        <div
                          className="flex flex-col gap-2.5 pl-4"
                          style={{ borderLeft: '2px solid var(--bid-border-2)' }}
                        >
                          {leaves.map(leaf => (
                            <div
                              key={leaf.id}
                              onClick={() => setSelectedId(leaf.id ?? null)}
                              onDoubleClick={() => {
                                setEditingId(leaf.id ?? null)
                                setDraft(leaf.title || '')
                              }}
                              className="group flex w-[280px] cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2.5"
                              style={{
                                background: '#fff',
                                border:
                                  selectedId === leaf.id
                                    ? '1px solid var(--bid-primary)'
                                    : '1px solid var(--bid-border)',
                              }}
                            >
                              {editingId === leaf.id ? (
                                <input
                                  autoFocus
                                  value={draft}
                                  onChange={e => setDraft(e.target.value)}
                                  onBlur={commitRename}
                                  onKeyDown={e => e.key === 'Enter' && commitRename()}
                                  className="flex-1 rounded-[5px] px-1.5 py-0.5 text-[13px] outline-none"
                                  style={{ border: '1px solid var(--bid-primary)' }}
                                />
                              ) : (
                                <span
                                  className="flex-1 text-[13px]"
                                  style={{ color: 'var(--bid-ink-2)' }}
                                >
                                  {leaf.title}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation()
                                  if (leaf.id) deleteNode(leaf.id)
                                }}
                                className="flex-shrink-0 rounded-md px-1.5 text-sm opacity-0 group-hover:opacity-100"
                                style={{ color: 'var(--bid-muted-2)' }}
                                title={t('phase2.delete')}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      </div>

      {/* Right: node detail / suggestions / change log */}
      <div
        className="flex w-[288px] flex-shrink-0 flex-col gap-4 overflow-auto p-4"
        style={{ borderLeft: '1px solid var(--bid-border)', background: 'var(--bid-paper-2)' }}
      >
        <div>
          <div className="mb-2 text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
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
                k={t('outline.detail_covers')}
                v={(selected.node.covers ?? []).join(', ') || '—'}
              />
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

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
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
            {coverage.uncovered_scoring.length === 0 && coverage.uncovered_clauses.length === 0 ? (
              <div
                className="rounded-[10px] p-3 text-[11.5px]"
                style={{ background: 'var(--bid-success-soft)', color: 'var(--bid-success)' }}
              >
                {t('outline.coverage_ok')} · {coverage.covered}/{coverage.total}
              </div>
            ) : (
              <>
                {coverage.uncovered_scoring.map(id => (
                  <SuggestionCard
                    key={`s-${id}`}
                    title={t('outline.uncovered_scoring')}
                    desc={id}
                  />
                ))}
                {coverage.uncovered_clauses.map(id => (
                  <SuggestionCard key={`c-${id}`} title={t('outline.uncovered_clause')} desc={id} />
                ))}
              </>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
            {t('outline.changelog')}
          </div>
          <div className="border-l-2 pl-2.5" style={{ borderColor: 'var(--bid-primary)' }}>
            <div className="text-[11px] font-bold" style={{ color: 'var(--bid-primary)' }}>
              v1.0
            </div>
            <div className="text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
              {t('outline.changelog_init')}
            </div>
          </div>
        </div>
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

function SuggestionCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div
      className="rounded-[10px] p-2.5"
      style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
    >
      <div className="mb-0.5 text-[11.5px] font-bold" style={{ color: 'var(--bid-ink-2)' }}>
        {title}
      </div>
      <div className="text-[11px]" style={{ color: 'var(--bid-muted)' }}>
        {desc}
      </div>
    </div>
  )
}
