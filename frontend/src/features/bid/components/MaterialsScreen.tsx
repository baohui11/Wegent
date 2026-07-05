// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type BriefsDoc, type NodeBrief, type OutlineDoc } from '@/apis/bid'
import {
  dfsOrder,
  flattenOutline,
  isVisible,
  leavesOf,
  type FlatNode,
} from '../canvas/outlineGraph'

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

// Is `id` a descendant of `ancestorId` in the flat tree?
function descendantOf(flat: FlatNode[], ancestorId: string, id: string): boolean {
  const map = new Map(flat.map(n => [n.id, n]))
  let cur = map.get(id)
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true
    cur = map.get(cur.parentId)
  }
  return false
}

export function MaterialsScreen({
  projectId,
  outline,
  onComplete,
}: {
  projectId: number | null
  outline?: OutlineDoc
  onComplete: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const flat = useMemo(() => flattenOutline(outline?.sections), [outline])
  const leaves = useMemo(() => leavesOf(flat), [flat])
  const rows = useMemo(() => dfsOrder(flat), [flat])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, NodeConfig>>({})
  const [requirements, setRequirements] = useState<Record<string, string>>({})
  const [materials, setMaterials] = useState<Material[]>([])
  const [company, setCompany] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Select the first leaf once the outline is available.
  useEffect(() => {
    if (!selectedId && leaves.length) setSelectedId(leaves[0].id)
  }, [leaves, selectedId])

  // Load persisted briefs + bidder info once per project.
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
    bidApis
      .getQualifications(projectId)
      .then(q => {
        if (alive) setCompany(String((q.qualifications as { company?: unknown }).company ?? ''))
      })
      .catch(() => {
        /* not prefilled yet */
      })
    return () => {
      alive = false
    }
  }, [projectId])

  const getConfig = (id: string): NodeConfig => configs[id] ?? defaultConfig()
  const patchConfig = (id: string, patch: Partial<NodeConfig>) =>
    setConfigs(prev => ({ ...prev, [id]: { ...getConfig(id), ...patch } }))

  const buildDoc = (mats: Material[] = materials): BriefsDoc => {
    const ids = new Set([...Object.keys(configs), ...Object.keys(requirements)])
    const briefs: Record<string, NodeBrief> = {}
    ids.forEach(id => {
      briefs[id] = { ...getConfig(id), requirements: requirements[id] ?? '' }
    })
    return { briefs, materials: mats }
  }
  const persist = async (mats?: Material[]) => {
    if (projectId == null) return
    try {
      await bidApis.saveBriefs(projectId, buildDoc(mats))
    } catch {
      /* keep editing; next save retries */
    }
  }

  const completion = (id: string): number => {
    const files = materials.filter(m => m.linkedNodeIds.includes(id)).length
    const req = (requirements[id] ?? '').trim().length > 0
    return Math.round((((files > 0 ? 1 : 0) + (req ? 1 : 0)) / 2) * 100)
  }

  const nodeStatus = (n: FlatNode): number => {
    const hasKids = flat.some(x => x.parentId === n.id)
    if (!hasKids) return completion(n.id)
    const leafDesc = leaves.filter(l => descendantOf(flat, n.id, l.id))
    return leafDesc.length
      ? leafDesc.reduce((a, l) => a + completion(l.id), 0) / leafDesc.length
      : 0
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

  const saveBidder = async () => {
    if (projectId == null) return
    const trimmed = company.trim()
    let quals: Record<string, unknown> = { items: [] }
    try {
      quals = (await bidApis.getQualifications(projectId)).qualifications
    } catch {
      /* not prefilled yet */
    }
    if (!Array.isArray(quals.items)) quals.items = []
    await bidApis.saveQualifications(projectId, { ...quals, company: trimmed })
    let inner: Record<string, unknown> = {}
    try {
      const kb = (await bidApis.getKnowledgeBase(projectId)).knowledge_base
      const existing = kb.bidder_knowledge_base
      if (existing && typeof existing === 'object') inner = existing as Record<string, unknown>
    } catch {
      /* kb not set yet */
    }
    await bidApis.saveKnowledgeBase(projectId, {
      bidder_knowledge_base: { ...inner, company: trimmed },
    })
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

  const inheritPrev = () => {
    if (!selectedId) return
    const idx = leaves.findIndex(l => l.id === selectedId)
    if (idx <= 0) return
    const prev = leaves[idx - 1]
    setConfigs(p => ({
      ...p,
      [selectedId]: { ...getConfig(prev.id) },
    }))
    setRequirements(p => ({ ...p, [selectedId]: requirements[prev.id] ?? '' }))
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
  const saveNext = () => {
    if (!selectedId) return
    void persist()
    const idx = leaves.findIndex(l => l.id === selectedId)
    if (idx >= 0 && idx < leaves.length - 1) setSelectedId(leaves[idx + 1].id)
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

  const figureOpts = [
    [t('phase2.yes'), '是'],
    [t('phase2.no'), '否'],
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
              const avg = nodeStatus(n)
              const status =
                avg >= 100
                  ? { label: t('phase2.status_configured'), color: 'var(--bid-success)' }
                  : avg > 0
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
                onClick={() => void persist()}
                data-testid="bid-materials-save"
                className="flex-1 rounded-[9px] py-2.5 text-[13px] font-bold"
                style={{
                  background: '#fff',
                  border: '1px solid var(--bid-primary)',
                  color: 'var(--bid-primary)',
                }}
              >
                {t('phase2.save')}
              </button>
              <button
                type="button"
                onClick={saveNext}
                data-testid="bid-materials-save-next"
                className="flex-1 rounded-[9px] py-2.5 text-[13px] font-bold text-white"
                style={{ background: 'var(--bid-primary)' }}
              >
                {t('phase2.save_next')}
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
              <SectionLabel>{t('phase2.bidder_info')}</SectionLabel>
              <InfoCard>
                <div className="text-[10.5px]" style={{ color: 'var(--bid-muted-2)' }}>
                  {t('phase2.bidder_company')}
                </div>
                <input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder={t('phase2.bidder_company_placeholder')}
                  data-testid="bid-bidder-company"
                  className="w-full rounded-[7px] px-2 py-1.5 text-xs outline-none"
                  style={{ border: '1px solid var(--bid-border-2)', background: '#fff' }}
                />
                <button
                  type="button"
                  onClick={() => void saveBidder()}
                  data-testid="bid-bidder-save"
                  className="rounded-[7px] px-2 py-1.5 text-[11px] font-bold"
                  style={{
                    background: 'var(--bid-primary-soft)',
                    border: '1px solid var(--bid-primary)',
                    color: 'var(--bid-primary)',
                  }}
                >
                  {t('phase2.bidder_save')}
                </button>
                <div className="text-[10px]" style={{ color: 'var(--bid-muted-3)' }}>
                  {t('phase2.bidder_hint')}
                </div>
              </InfoCard>
            </div>

            <div>
              <SectionLabel>{t('phase2.node_info')}</SectionLabel>
              <InfoCard>
                <InfoRow k={t('phase2.suggested_words')} v={`${cfg.wordMin} - ${cfg.wordMax} 字`} />
                <InfoRow
                  k={t('phase2.priority')}
                  v={<span style={{ color: '#E8A93C' }}>★★★★☆</span>}
                />
                <InfoRow k={t('phase2.scoring_ref')} v={selected.covers?.join('/') || '—'} />
              </InfoCard>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel className="mb-0">{t('phase2.parse_result')}</SectionLabel>
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px]"
                  style={{ background: 'var(--bid-primary-soft)', color: 'var(--bid-primary)' }}
                >
                  {t('phase2.ai_extract')}
                </span>
              </div>
              <InfoCard>
                <InfoRow
                  k={t('phase2.keypoints')}
                  v={t('phase2.unit_items', { n: files.length * 3 + (reqText.length > 0 ? 2 : 0) })}
                  bold
                />
                <InfoRow
                  k={t('phase2.images')}
                  v={t('phase2.unit_images', { n: Math.min(files.length, 6) })}
                  bold
                />
                <InfoRow
                  k={t('phase2.tables')}
                  v={t('phase2.unit_tables', { n: Math.min(files.length, 3) })}
                  bold
                />
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
                <QuickAction onClick={inheritPrev}>{t('phase2.inherit_prev')}</QuickAction>
                <QuickAction onClick={autoFill}>{t('phase2.auto_fill')}</QuickAction>
                <button
                  type="button"
                  onClick={async () => {
                    await persist()
                    onComplete()
                  }}
                  data-testid="bid-materials-complete-button"
                  className="rounded-[9px] px-3 py-2 text-left text-[11.5px] font-bold"
                  style={{
                    background: 'var(--bid-primary-soft)',
                    border: '1px solid var(--bid-primary)',
                    color: 'var(--bid-primary)',
                  }}
                >
                  {t('phase2.enter_generation')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
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

function QuickAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[9px] px-3 py-2 text-left text-[11.5px]"
      style={{ background: '#fff', border: '1px solid var(--bid-border)', color: 'var(--bid-sub)' }}
    >
      {children}
    </button>
  )
}
