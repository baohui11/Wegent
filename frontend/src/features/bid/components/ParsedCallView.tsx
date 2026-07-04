// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

// The tender-sleuth response is per-block JSON whose exact field names vary
// run-to-run (qwen/mimo are not schema-stable). So this renderer is
// SHAPE-driven, not field-name driven: arrays become counted lists, objects
// become label→value rows, and field labels come from a best-effort map with a
// humanized fallback. Unparseable content falls back to the raw text.

// Common bid field → [zh, en] label. Unknown keys fall back to a humanized key.
const FIELD_LABELS: Record<string, [string, string]> = {
  name: ['名称', 'Name'],
  id: ['编号', 'ID'],
  budget: ['预算', 'Budget'],
  deadline: ['截止时间', 'Deadline'],
  bid_deadline: ['截止时间', 'Deadline'],
  purchasing_org: ['采购单位', 'Purchaser'],
  purchaser: ['采购单位', 'Purchaser'],
  supervising_dept: ['监管单位', 'Supervisor'],
  project_unit: ['项目单位', 'Project unit'],
  is_single_package: ['单一分包', 'Single package'],
  allow_consortium: ['允许联合体', 'Consortium allowed'],
  clarification: ['澄清', 'Clarification'],
  requirement: ['要求', 'Requirement'],
  clause: ['条款', 'Clause'],
  clause_text: ['条款', 'Clause'],
  clause_source: ['出处', 'Source'],
  clause_type: ['类型', 'Type'],
  text: ['内容', 'Text'],
  veto: ['废标', 'Veto'],
  is_veto: ['废标', 'Veto'],
  weight: ['分值', 'Score'],
  max_score: ['分值', 'Score'],
  weights: ['权重', 'Weights'],
  must_keep: ['关键要点', 'Key points'],
  price_formula: ['报价公式', 'Price formula'],
  tech_rubric_code: ['技术评分编号', 'Tech rubric'],
  package_info: ['分包信息', 'Package'],
  item: ['评分项', 'Item'],
  title: ['标题', 'Title'],
  sections: ['章节', 'Sections'],
  children: ['子章节', 'Sub-sections'],
  tech_items: ['技术评分项', 'Tech items'],
  biz_items: ['商务评分项', 'Business items'],
  price_items: ['价格评分项', 'Price items'],
  target_section: ['对应章节', 'Target section'],
  location: ['出处', 'Location'],
  notes: ['备注', 'Notes'],
  fallback_used: ['使用兜底骨架', 'Fallback used'],
  fallback_reason: ['兜底原因', 'Fallback reason'],
  description: ['描述', 'Description'],
  requirements: ['要求', 'Requirements'],
}

// Fields tried (in order) as an array item's headline text.
const PRIMARY_FIELDS = [
  'clause',
  'clause_text',
  'text',
  'requirement',
  'item',
  'title',
  'name',
  'description',
  'desc',
]

function stripFence(t: string): string {
  let s = t.trim()
  if (s.startsWith('```')) {
    const nl = s.indexOf('\n')
    s = nl >= 0 ? s.slice(nl + 1) : s
    const end = s.lastIndexOf('```')
    if (end >= 0) s = s.slice(0, end)
  }
  return s.trim()
}

function parseResponse(response: string, label: string): unknown {
  try {
    const obj = JSON.parse(stripFence(response))
    // Unwrap the {blockName: content} envelope: prefer the labelled key, else
    // any single top-level key.
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const rec = obj as Record<string, unknown>
      if (label && label in rec) return rec[label]
      const keys = Object.keys(rec)
      if (keys.length === 1) return rec[keys[0]]
    }
    return obj
  } catch {
    return undefined
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function ParsedCallView({ response, label }: { response: string; label: string }) {
  const { t, i18n } = useTranslation('bidWorkbench')
  const zh = (i18n.language || 'zh').startsWith('zh')
  const [showRaw, setShowRaw] = useState(false)
  const parsed = useMemo(() => parseResponse(response, label), [response, label])

  const humanize = (k: string): string => {
    const hit = FIELD_LABELS[k]
    if (hit) return zh ? hit[0] : hit[1]
    return k.replace(/_/g, ' ')
  }

  const primaryText = (o: Record<string, unknown>): string => {
    for (const f of PRIMARY_FIELDS) {
      const v = o[f]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    // No obvious headline field: show the first primitive value.
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (typeof v === 'number') return String(v)
    }
    return zh ? '（无摘要）' : '(no summary)'
  }

  const renderScalar = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'boolean') return v ? (zh ? '是' : 'Yes') : zh ? '否' : 'No'
    return String(v)
  }

  const label_ = 'text-[10px] font-semibold'
  const labelStyle = { color: 'var(--bid-muted-2)' }
  const valStyle = { color: 'var(--bid-ink-2)' }

  // Render one array item (object → headline + id/veto tags; primitive → text).
  const renderItem = (item: unknown, idx: number) => {
    if (isPlainObject(item)) {
      const idVal = item.id ?? item.code
      const veto = item.veto === true || item.is_veto === true
      const score = item.weight ?? item.max_score
      return (
        <div
          key={idx}
          className="rounded-md px-2 py-1.5"
          style={{ background: 'var(--bid-paper)', border: '1px solid var(--bid-border)' }}
        >
          <div className="flex items-start gap-1.5">
            {idVal != null && (
              <span
                className="flex-shrink-0 rounded px-1 text-[9.5px] font-bold"
                style={{ background: 'var(--bid-primary-soft)', color: 'var(--bid-primary)' }}
              >
                {String(idVal)}
              </span>
            )}
            <span className="min-w-0 flex-1 text-[11px]" style={valStyle}>
              {primaryText(item)}
            </span>
            {score != null && (
              <span className="flex-shrink-0 text-[10px]" style={{ color: '#C77700' }}>
                {String(score)}
                {zh ? '分' : 'pt'}
              </span>
            )}
            {veto && (
              <span className="flex-shrink-0 text-[9.5px] font-bold" style={{ color: '#B3453D' }}>
                ★ {zh ? '废标' : 'Veto'}
              </span>
            )}
          </div>
        </div>
      )
    }
    return (
      <div key={idx} className="text-[11px]" style={valStyle}>
        · {renderScalar(item)}
      </div>
    )
  }

  // Render a value: object → label rows; array → count + items; scalar → text.
  const renderValue = (value: unknown, depth = 0): React.ReactNode => {
    if (Array.isArray(value)) {
      if (value.length === 0)
        return <span style={{ color: 'var(--bid-muted-3)' }}>{zh ? '无' : 'None'}</span>
      return (
        <div className="flex flex-col gap-1">
          <div className="text-[10px]" style={{ color: 'var(--bid-muted-3)' }}>
            {zh ? `共 ${value.length} 项` : `${value.length} items`}
          </div>
          {value.slice(0, 20).map((it, i) => renderItem(it, i))}
          {value.length > 20 && (
            <div className="text-[10px]" style={{ color: 'var(--bid-muted-3)' }}>
              …{zh ? `还有 ${value.length - 20} 项` : `${value.length - 20} more`}
            </div>
          )}
        </div>
      )
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value).filter(
        ([, v]) => v !== null && v !== '' && v !== undefined
      )
      if (entries.length === 0) return <span style={{ color: 'var(--bid-muted-3)' }}>—</span>
      return (
        <div className="flex flex-col gap-1.5">
          {entries.map(([k, v]) => {
            const nested = Array.isArray(v) || isPlainObject(v)
            if (nested && depth >= 2) {
              // Too deep — summarize instead of recursing further.
              return (
                <div key={k} className="flex gap-2">
                  <span className={label_} style={labelStyle}>
                    {humanize(k)}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--bid-muted-3)' }}>
                    {Array.isArray(v) ? (zh ? `${v.length} 项` : `${v.length} items`) : '{…}'}
                  </span>
                </div>
              )
            }
            return (
              <div key={k} className={nested ? '' : 'flex items-baseline gap-2'}>
                <span className={label_} style={labelStyle}>
                  {humanize(k)}
                </span>
                {nested ? (
                  <div className="mt-1 pl-2">{renderValue(v, depth + 1)}</div>
                ) : (
                  <span className="text-[11px]" style={valStyle}>
                    {renderScalar(v)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )
    }
    return (
      <span className="text-[11px]" style={valStyle}>
        {renderScalar(value)}
      </span>
    )
  }

  // Unparseable → fall back to raw text (still better than nothing).
  if (parsed === undefined) {
    return (
      <pre
        data-testid="bid-llm-call-response"
        className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10.5px]"
        style={{ color: 'var(--bid-ink-2)' }}
      >
        {response || (zh ? '（暂无内容）' : '(no content)')}
      </pre>
    )
  }

  return (
    <div data-testid="bid-llm-call-response" className="max-h-56 overflow-auto">
      {showRaw ? (
        <pre
          className="whitespace-pre-wrap break-all text-[10.5px]"
          style={{ color: 'var(--bid-ink-2)' }}
        >
          {response}
        </pre>
      ) : (
        renderValue(parsed)
      )}
      <button
        type="button"
        onClick={() => setShowRaw(s => !s)}
        className="mt-2 text-[10px] underline"
        style={{ color: 'var(--bid-muted-2)' }}
      >
        {showRaw ? t('outline.view_parsed') : t('outline.view_raw')}
      </button>
    </div>
  )
}
