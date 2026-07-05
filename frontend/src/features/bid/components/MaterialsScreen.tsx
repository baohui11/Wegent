// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import {
  bidApis,
  type BriefsDoc,
  type NodeBrief,
  type OutlineDoc,
  type SectionGrounding,
} from '@/apis/bid'
import {
  dfsOrder,
  flattenOutline,
  isDescendantOf,
  isVisible,
  type FlatNode,
} from '../canvas/outlineGraph'
import { ConfirmDialog } from './ConfirmDialog'

interface NodeConfig {
  wordMin: string
  wordMax: string
  emphasis: string
  needFigure: string
  priority: string
}

interface Material {
  id: string
  name: string
  size: number
  linkedNodeIds: string[]
  stats?: { chars: number; pages: number; tables: number; images: number } | null
}

const defaultConfig = (): NodeConfig => ({
  wordMin: '',
  wordMax: '',
  emphasis: '',
  needFigure: '否',
  priority: '',
})

let matSeq = 0

export function MaterialsScreen({
  projectId,
  outline,
  onComplete: _onComplete,
  persistRef,
}: {
  projectId: number | null
  outline?: OutlineDoc
  onComplete: () => void
  persistRef?: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  const { t } = useTranslation('bidWorkbench')
  const flat = useMemo(() => flattenOutline(outline?.sections), [outline])
  const rows = useMemo(() => dfsOrder(flat), [flat])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, NodeConfig>>({})
  const [requirements, setRequirements] = useState<Record<string, string>>({})
  const [materials, setMaterials] = useState<Material[]>([])
  const [grounding, setGrounding] = useState<Record<string, SectionGrounding>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Which save action is currently reflecting saveState, so the feedback shows
  // on the button the user actually clicked (not always the first one).
  const [savingWhich, setSavingWhich] = useState<'this' | 'next' | null>(null)
  const [confirmBatch, setConfirmBatch] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Auto-select the first content leaf (a sensible starting point); chapters
  // stay selectable/configurable, this just avoids landing on a container.
  useEffect(() => {
    if (selectedId || !rows.length) return
    const firstLeaf = rows.find(n => !flat.some(x => x.parentId === n.id))
    setSelectedId((firstLeaf ?? rows[0]).id)
  }, [rows, flat, selectedId])

  // Load persisted briefs once per project.
  useEffect(() => {
    if (projectId == null) return
    let alive = true
    bidApis
      .getBriefs(projectId)
      .then(doc => {
        if (!alive) return
        const cfgs: Record<string, NodeConfig> = {}
        const reqs: Record<string, string> = {}
        Object.entries(doc.briefs ?? {}).forEach(([id, b]) => {
          const { requirements: r, ...rest } = b as Record<string, unknown>
          cfgs[id] = { ...defaultConfig(), ...(rest as Partial<NodeConfig>) }
          if (typeof r === 'string') reqs[id] = r
        })
        setConfigs(cfgs)
        setRequirements(reqs)
        setMaterials((doc.materials ?? []) as Material[])
      })
      .catch(() => {
        /* first visit: nothing persisted yet */
      })
    return () => {
      alive = false
    }
  }, [projectId])

  // Per-node grounding (scoring/veto clauses each node covers), resolved by the
  // backend from the canonical tender — no client-side id->text join.
  useEffect(() => {
    if (projectId == null) return
    let alive = true
    bidApis
      .getGrounding(projectId)
      .then(doc => {
        if (alive) setGrounding(doc.items ?? {})
      })
      .catch(() => {
        /* no outline/tender yet -> empty grounding */
      })
    return () => {
      alive = false
    }
  }, [projectId])

  const getConfig = (id: string): NodeConfig => configs[id] ?? defaultConfig()
  const patchConfig = (id: string, patch: Partial<NodeConfig>) =>
    setConfigs(prev => ({ ...prev, [id]: { ...getConfig(id), ...patch } }))

  const buildDoc = (
    mats: Material[] = materials,
    cfgs: Record<string, NodeConfig> = configs,
    reqs: Record<string, string> = requirements
  ): BriefsDoc => {
    const ids = new Set([...Object.keys(cfgs), ...Object.keys(reqs)])
    const briefs: Record<string, NodeBrief> = {}
    ids.forEach(id => {
      briefs[id] = { ...(cfgs[id] ?? defaultConfig()), requirements: reqs[id] ?? '' }
    })
    return { briefs, materials: mats }
  }
  const persist = async (
    mats?: Material[],
    cfgs?: Record<string, NodeConfig>,
    reqs?: Record<string, string>
  ): Promise<boolean> => {
    if (projectId == null) return false
    setSaveState('saving')
    try {
      await bidApis.saveBriefs(projectId, buildDoc(mats, cfgs, reqs))
      setSaveState('saved')
      window.setTimeout(() => {
        setSaveState('idle')
        setSavingWhich(null)
      }, 1500)
      return true
    } catch {
      setSaveState('error')
      return false
    }
  }

  // Expose the persist callback so the shell header can save before opening the
  // drafting confirm dialog (single entry point that always persists first).
  useEffect(() => {
    if (persistRef)
      persistRef.current = async () => {
        await persist()
      }
  })

  const completion = (id: string): number => {
    const files = materials.filter(m => m.linkedNodeIds.includes(id)).length
    const req = (requirements[id] ?? '').trim().length > 0
    return Math.round((((files > 0 ? 1 : 0) + (req ? 1 : 0)) / 2) * 100)
  }

  // Per-node config state — every node (chapters included) is a drafted section
  // (backend flatten_sections drafts them all), so each is judged by its OWN
  // config, not aggregated from children. Requirements is the gate; materials
  // are optional:
  //   2 configured  = has specific requirements
  //   1 in progress = touched (materials or emphasis) but no requirements yet
  //   0 pending     = untouched
  const nodeConfigState = (id: string): 0 | 1 | 2 => {
    if ((requirements[id] ?? '').trim().length > 0) return 2
    const hasMat = materials.some(m => m.linkedNodeIds.includes(id))
    const hasEmph = (getConfig(id).emphasis ?? '').trim().length > 0
    return hasMat || hasEmph ? 1 : 0
  }

  const toggleCollapse = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedId || projectId == null) return
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!picked.length) return
    const added: Material[] = []
    for (const f of picked) {
      try {
        const info = await bidApis.uploadAttachment(projectId, f)
        added.push({
          id: `m${Date.now()}_${matSeq++}`,
          name: info.name,
          size: info.size,
          linkedNodeIds: [selectedId],
          stats: info.stats ?? null,
        })
      } catch {
        /* skip failed upload; user can retry */
      }
    }
    if (added.length) {
      const next = [...materials, ...added]
      setMaterials(next)
      void persist(next)
    }
  }

  const removeMaterial = (mid: string, nodeId: string) =>
    setMaterials(prev =>
      prev
        .map(m =>
          m.id === mid ? { ...m, linkedNodeIds: m.linkedNodeIds.filter(i => i !== nodeId) } : m
        )
        .filter(m => m.linkedNodeIds.length > 0)
    )
  const linkMaterial = (mid: string, nodeId: string) =>
    setMaterials(prev =>
      prev.map(m =>
        m.id === mid && !m.linkedNodeIds.includes(nodeId)
          ? { ...m, linkedNodeIds: [...m.linkedNodeIds, nodeId] }
          : m
      )
    )

  // All descendant sections under the selected node (its whole subtree). The
  // selected node is the source; batch propagates its config down to these.
  const descendantNodes = (): FlatNode[] =>
    selectedId ? rows.filter(n => isDescendantOf(flat, selectedId, n.id)) : []
  // Batch: apply the selected node's writing config + requirements to every node
  // belonging to it (all descendants), overwriting them. Priority is excluded —
  // it derives per-node from that node's own covered scoring/veto clauses.
  const doApplyToChildren = () => {
    if (!selectedId) return
    const targets = descendantNodes()
    if (!targets.length) return
    const { priority: _priority, ...srcCfg } = getConfig(selectedId)
    const srcReq = requirements[selectedId] ?? ''
    const nextConfigs = { ...configs }
    const nextReqs = { ...requirements }
    targets.forEach(n => {
      nextConfigs[n.id] = { ...getConfig(n.id), ...srcCfg }
      nextReqs[n.id] = srcReq
    })
    setConfigs(nextConfigs)
    setRequirements(nextReqs)
    void persist(undefined, nextConfigs, nextReqs)
  }
  const autoFill = () => {
    if (!selectedId) return
    const node = flat.find(n => n.id === selectedId)
    if (!(requirements[selectedId] ?? '').trim()) {
      setRequirements(p => ({
        ...p,
        [selectedId]: t('phase2.auto_fill_text', { name: node?.name ?? '' }),
      }))
    }
  }
  const saveNext = async () => {
    if (!selectedId) return
    setSavingWhich('next')
    const ok = await persist()
    if (!ok) return // failed save keeps the user on this node (error shown)
    const idx = rows.findIndex(n => n.id === selectedId)
    if (idx >= 0 && idx < rows.length - 1) setSelectedId(rows[idx + 1].id)
  }

  // Label/color for a save button, reflecting saveState only for the action the
  // user actually triggered.
  const saveBtnLabel = (which: 'this' | 'next', dflt: string): string => {
    if (savingWhich !== which) return dflt
    if (saveState === 'saving') return t('phase2.saving')
    if (saveState === 'saved') return t('phase2.saved')
    if (saveState === 'error') return t('phase2.save_error')
    return dflt
  }

  const selected = selectedId ? (flat.find(n => n.id === selectedId) ?? null) : null
  const parent = selected?.parentId ? (flat.find(n => n.id === selected.parentId) ?? null) : null
  const cfg = selectedId ? getConfig(selectedId) : defaultConfig()
  const files = selectedId ? materials.filter(m => m.linkedNodeIds.includes(selectedId)) : []
  const libraryItems = selectedId
    ? materials.filter(m => !m.linkedNodeIds.includes(selectedId) && m.linkedNodeIds.length > 0)
    : []
  const reqText = selectedId ? (requirements[selectedId] ?? '') : ''
  const comp = selectedId ? completion(selectedId) : 0

  // Backend-resolved covers for the selected node (scoring items + veto clauses).
  const g = selectedId ? grounding[selectedId] : undefined
  const resolvedCovers: { text: string; veto: boolean; weight?: number }[] = [
    ...(g?.clauses ?? []).map(c => ({ text: c.text || c.id, veto: !!c.veto })),
    ...(g?.scoring ?? []).map(s => ({ text: s.item || s.id, veto: false, weight: s.weight })),
  ]
  const derivedPriority = (): string => {
    if (resolvedCovers.some(c => c.veto)) return '高'
    const w = resolvedCovers.reduce((a, c) => a + (c.weight ?? 0), 0)
    if (w >= 20) return '高'
    if (w > 0) return '中'
    return '中'
  }
  const priorityValue = cfg.priority || derivedPriority()

  const figureOpts = [
    [t('phase2.yes'), '是'],
    [t('phase2.no'), '否'],
  ] as const
  const priorityOpts = [
    [t('phase2.priority_high'), '高'],
    [t('phase2.priority_mid'), '中'],
    [t('phase2.priority_low'), '低'],
  ] as const

  return (
    <div className="flex h-full overflow-x-auto" data-testid="bid-materials-screen">
      {/* Left: outline tree with per-node status */}
      <div
        className="flex-shrink-0 overflow-auto p-2"
        style={{
          width: 264,
          borderRight: '1px solid var(--bid-border)',
          background: 'var(--bid-paper-2)',
        }}
      >
        <div className="flex flex-col gap-0.5" data-testid="bid-materials-tree">
          {rows
            .filter(n => isVisible(flat, n, collapsed))
            .map(n => {
              const hasKids = flat.some(x => x.parentId === n.id)
              const st = nodeConfigState(n.id)
              const status =
                st === 2
                  ? { label: t('phase2.status_configured'), color: 'var(--bid-success)' }
                  : st === 1
                    ? { label: t('phase2.status_progress'), color: '#C77700' }
                    : { label: t('phase2.status_todo'), color: 'var(--bid-muted-2)' }
              const isSel = selectedId === n.id
              return (
                <div
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md py-1.5"
                  style={{
                    paddingLeft: 8 + n.depth * 14,
                    paddingRight: 8,
                    background: isSel ? 'var(--bid-primary-soft)' : 'transparent',
                  }}
                >
                  {hasKids && (
                    <span
                      onClick={e => {
                        e.stopPropagation()
                        toggleCollapse(n.id)
                      }}
                      className="inline-block flex-shrink-0 text-[9px]"
                      style={{
                        opacity: 0.6,
                        transform: collapsed.has(n.id) ? 'none' : 'rotate(90deg)',
                        transition: 'transform .15s',
                      }}
                    >
                      ▸
                    </span>
                  )}
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{
                      fontSize: n.depth === 0 ? 12.5 : 12,
                      fontWeight: n.depth === 0 ? 700 : 500,
                      color: isSel ? 'var(--bid-primary)' : 'var(--bid-ink-2)',
                    }}
                  >
                    {n.name}
                  </span>
                  <span
                    className="flex-shrink-0 rounded-md px-1.5 py-px text-[10px]"
                    style={{ background: `${status.color}1F`, color: status.color }}
                  >
                    {status.label}
                  </span>
                </div>
              )
            })}
        </div>
      </div>

      {/* Center: per-node upload + writing requirements */}
      <div className="min-w-[460px] flex-1 overflow-auto px-6 py-5">
        {selected ? (
          <>
            <div className="mb-3.5 text-[11.5px]" style={{ color: 'var(--bid-muted-2)' }}>
              {parent ? `${parent.name} > ` : ''}
              {selected.name}
            </div>

            <SectionLabel>{t('phase2.upload_title')}</SectionLabel>
            <div
              onClick={() => fileRef.current?.click()}
              data-testid="bid-materials-dropzone"
              className="cursor-pointer rounded-xl p-7 text-center"
              style={{ border: '1.5px dashed var(--bid-border-2)', background: '#fff' }}
            >
              <div className="mb-1.5 text-2xl">☁️</div>
              <div className="text-[12.5px]" style={{ color: 'var(--bid-sub)' }}>
                {t('phase2.upload_hint')}
              </div>
              <div className="mt-1 text-[10.5px]" style={{ color: 'var(--bid-muted-3)' }}>
                {t('phase2.upload_types')}
              </div>
            </div>
            <input ref={fileRef} type="file" multiple onChange={onFiles} className="hidden" />
            {files.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {files.map(f => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-xs"
                    style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
                  >
                    <span>📄</span>
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
                      {Math.max(1, Math.round(f.size / 1024))} KB
                    </span>
                    <span
                      onClick={() => removeMaterial(f.id, selected.id)}
                      className="cursor-pointer"
                      style={{ color: '#B3453D' }}
                    >
                      ×
                    </span>
                  </div>
                ))}
              </div>
            )}

            {libraryItems.length > 0 && (
              <>
                <SectionLabel className="mt-4">{t('phase2.library_title')}</SectionLabel>
                {libraryItems.map(m => (
                  <div
                    key={m.id}
                    className="mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs"
                    style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
                  >
                    <span className="min-w-0 flex-1 truncate">📄 {m.name}</span>
                    <span className="text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
                      {t('phase2.library_linked', { count: m.linkedNodeIds.length })}
                    </span>
                    <span
                      onClick={() => linkMaterial(m.id, selected.id)}
                      className="cursor-pointer font-bold"
                      style={{ color: 'var(--bid-primary)' }}
                    >
                      {t('phase2.library_link')}
                    </span>
                  </div>
                ))}
              </>
            )}

            <SectionLabel className="mt-[18px]">{t('phase2.req_title')}</SectionLabel>
            <div className="grid grid-cols-3 gap-2.5">
              <Field label={t('phase2.field_words')}>
                <div className="flex items-center gap-1">
                  <BareInput
                    value={cfg.wordMin}
                    onChange={v => patchConfig(selected.id, { wordMin: v })}
                  />
                  <span style={{ color: 'var(--bid-muted-3)' }}>-</span>
                  <BareInput
                    value={cfg.wordMax}
                    onChange={v => patchConfig(selected.id, { wordMax: v })}
                  />
                </div>
              </Field>
              <Field label={t('phase2.field_emphasis')}>
                <BareInput
                  value={cfg.emphasis}
                  onChange={v => patchConfig(selected.id, { emphasis: v })}
                />
              </Field>
              <Field label={t('phase2.field_need_figure')}>
                <NativeSelect
                  value={cfg.needFigure}
                  onChange={v => patchConfig(selected.id, { needFigure: v })}
                  options={figureOpts}
                />
              </Field>
            </div>

            <SectionLabel className="mt-[18px]">{t('phase2.detail_title')}</SectionLabel>
            <textarea
              value={reqText}
              onChange={e => setRequirements(p => ({ ...p, [selected.id]: e.target.value }))}
              placeholder={t('phase2.detail_placeholder')}
              data-testid="bid-materials-requirement"
              className="min-h-[120px] w-full resize-y rounded-[10px] p-3 text-[12.5px] outline-none"
              style={{
                border: '1px solid var(--bid-border-2)',
                background: '#fff',
                fontFamily: 'inherit',
              }}
            />

            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setSavingWhich('this')
                  void persist()
                }}
                data-testid="bid-materials-save"
                className="flex-1 rounded-[9px] py-2.5 text-[13px] font-bold"
                style={{
                  background: '#fff',
                  border: '1px solid var(--bid-primary)',
                  color:
                    savingWhich === 'this' && saveState === 'error'
                      ? '#B3453D'
                      : savingWhich === 'this' && saveState === 'saved'
                        ? 'var(--bid-success)'
                        : 'var(--bid-primary)',
                }}
              >
                {saveBtnLabel('this', t('phase2.save'))}
              </button>
              <button
                type="button"
                onClick={saveNext}
                data-testid="bid-materials-save-next"
                className="flex-1 rounded-[9px] py-2.5 text-[13px] font-bold text-white"
                style={{ background: 'var(--bid-primary)' }}
              >
                {saveBtnLabel('next', t('phase2.save_next'))}
              </button>
            </div>
          </>
        ) : (
          <div
            className="mt-10 rounded-xl p-8 text-center text-[12.5px]"
            style={{ border: '1px dashed var(--bid-border)', color: 'var(--bid-muted-3)' }}
          >
            {t('phase2.pick_node')}
          </div>
        )}
      </div>

      {/* Right: node info / parse result / completion / quick actions */}
      <div
        className="flex flex-shrink-0 flex-col gap-4 overflow-auto p-4"
        style={{
          width: 296,
          borderLeft: '1px solid var(--bid-border)',
          background: 'var(--bid-paper-2)',
        }}
      >
        {selected && (
          <>
            <div>
              <SectionLabel>{t('phase2.node_info')}</SectionLabel>
              <InfoCard>
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
                    {t('phase2.priority')}
                  </span>
                  <select
                    value={priorityValue}
                    onChange={e => patchConfig(selected.id, { priority: e.target.value })}
                    data-testid="bid-materials-priority"
                    className="rounded-[7px] px-1.5 py-1 text-[11px] outline-none"
                    style={{ border: '1px solid var(--bid-border-2)', background: '#fff' }}
                  >
                    {priorityOpts.map(([label, val]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {resolvedCovers.length ? (
                  resolvedCovers.map((c, i) => (
                    <InfoRow
                      key={i}
                      k={c.veto ? t('phase2.veto_clause') : t('phase2.scoring_item')}
                      v={
                        <span>
                          {c.text}
                          {c.weight != null ? ` · ${c.weight}${t('phase2.points')}` : ''}
                        </span>
                      }
                    />
                  ))
                ) : (
                  <InfoRow k={t('phase2.scoring_ref')} v="—" />
                )}
              </InfoCard>
            </div>

            <div>
              <SectionLabel>{t('phase2.node_materials')}</SectionLabel>
              <InfoCard>
                {files.length === 0 ? (
                  <div className="text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
                    {t('phase2.no_materials')}
                  </div>
                ) : (
                  files.map(f => (
                    <div key={f.id} className="flex flex-col gap-0.5">
                      <div className="truncate text-[11.5px]" style={{ color: 'var(--bid-ink-2)' }}>
                        📄 {f.name}
                      </div>
                      <div className="text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
                        {f.stats
                          ? t('phase2.stats_line', {
                              chars: f.stats.chars,
                              pages: f.stats.pages,
                              tables: f.stats.tables,
                              images: f.stats.images,
                            })
                          : t('phase2.stats_unavailable')}
                      </div>
                    </div>
                  ))
                )}
              </InfoCard>
            </div>

            <div>
              <SectionLabel>{t('phase2.completion')}</SectionLabel>
              <div className="flex items-center gap-3.5">
                <div
                  className="flex flex-shrink-0 items-center justify-center rounded-full"
                  style={{
                    width: 66,
                    height: 66,
                    background: `conic-gradient(var(--bid-primary) ${comp * 3.6}deg, #EEE6E4 0deg)`,
                  }}
                >
                  <div
                    className="flex items-center justify-center rounded-full text-xs font-extrabold"
                    style={{ width: 50, height: 50, background: '#fff', color: 'var(--bid-ink-2)' }}
                  >
                    {comp}%
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  {(
                    [
                      [t('phase2.completion_files'), files.length > 0],
                      [t('phase2.completion_req'), reqText.trim().length > 0],
                    ] as const
                  ).map(([label, ok]) => (
                    <div key={label} className="flex justify-between text-[10.5px]">
                      <span style={{ color: 'var(--bid-muted)' }}>{label}</span>
                      <span
                        className="font-bold"
                        style={{ color: ok ? 'var(--bid-success)' : 'var(--bid-muted-2)' }}
                      >
                        {ok ? t('phase2.done') : t('phase2.todo')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <SectionLabel>{t('phase2.quick_actions')}</SectionLabel>
              <div className="flex flex-col gap-2">
                <QuickAction
                  onClick={() => setConfirmBatch(true)}
                  disabled={descendantNodes().length === 0}
                  title={
                    descendantNodes().length === 0 ? t('phase2.apply_children_none') : undefined
                  }
                >
                  {t('phase2.apply_children')}
                </QuickAction>
                <QuickAction onClick={autoFill}>{t('phase2.auto_fill')}</QuickAction>
              </div>
            </div>
          </>
        )}
      </div>
      {confirmBatch && (
        <ConfirmDialog
          title={t('phase2.apply_children')}
          desc={t('phase2.apply_children_confirm', { count: descendantNodes().length })}
          cancel={t('outline.delete_cancel')}
          confirm={t('phase2.apply_children_ok')}
          onCancel={() => setConfirmBatch(false)}
          onConfirm={() => {
            setConfirmBatch(false)
            doApplyToChildren()
          }}
        />
      )}
    </div>
  )
}

function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`mb-2 text-[12.5px] font-extrabold ${className}`}
      style={{ color: 'var(--bid-sub)' }}
    >
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly (readonly [string, string])[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-[7px] px-2 py-1.5 text-xs outline-none"
      style={{ border: '1px solid var(--bid-border-2)', background: '#fff' }}
    >
      {options.map(([label, val]) => (
        <option key={val} value={val}>
          {label}
        </option>
      ))}
    </select>
  )
}

function BareInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-[7px] px-1.5 py-1.5 text-xs outline-none"
      style={{ border: '1px solid var(--bid-border-2)', background: '#fff' }}
    />
  )
}

function InfoCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-[10px] p-3"
      style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
    >
      {children}
    </div>
  )
}

function InfoRow({ k, v, bold }: { k: string; v: ReactNode; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
        {k}
      </span>
      <span
        className="text-[11.5px]"
        style={{ color: 'var(--bid-ink-2)', fontWeight: bold ? 700 : 400 }}
      >
        {v}
      </span>
    </div>
  )
}

function QuickAction({
  onClick,
  children,
  disabled = false,
  title,
}: {
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-[9px] px-3 py-2 text-left text-[11.5px]"
      style={{
        background: '#fff',
        border: '1px solid var(--bid-border)',
        color: disabled ? 'var(--bid-muted-3)' : 'var(--bid-sub)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  )
}
