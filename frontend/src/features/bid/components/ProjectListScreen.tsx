// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/hooks/useTranslation'
import { useUser } from '@/features/common/UserContext'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { bidThemeVars } from '@/features/bid/theme'
import { bidApis, type BidProject } from '@/apis/bid'

function gateOf(p: BidProject): number {
  return Math.min(6, Math.max(1, p.current_phase))
}

// Derive a display status that never contradicts the gate badge. The backend
// `status` string is only reliable for parsing/parse_failed/created; past that
// it goes stale (e.g. stays 'drafting' after finalize), so fall back to the
// phase cursor for everything else.
function statusKey(p: BidProject): string {
  if (p.status === 'parsing') return 'parsing'
  if (p.status === 'parse_failed') return 'parse_failed'
  if (p.current_phase >= 7 || p.status === 'done') return 'done'
  if (p.status === 'created' && p.current_phase <= 1) return 'created'
  return 'in_progress'
}

// Status badge palette (bg / text / dot), keyed by statusKey.
const STATUS_COLORS: Record<string, { bg: string; fg: string; dot: string }> = {
  created: { bg: '#F1EEEB', fg: '#8A8481', dot: '#B7ADA7' },
  parsing: { bg: '#FBEAEA', fg: '#C77700', dot: '#C77700' },
  parse_failed: { bg: '#FBEAEA', fg: '#C7102A', dot: '#C7102A' },
  in_progress: { bg: '#FBEAEA', fg: '#C7102A', dot: '#C7102A' },
  done: { bg: '#EAF7F0', fg: '#1E8E5A', dot: '#1E8E5A' },
}

// Statuses users can filter by (mirror statusKey outputs, 'all' clears it).
const STATUS_FILTERS = ['all', 'created', 'parsing', 'parse_failed', 'in_progress', 'done'] as const

type SortKey = 'created_desc' | 'created_asc'

export function ProjectListScreen({
  onOpen,
  onNew,
}: {
  onOpen: (p: BidProject) => void
  onNew: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const router = useRouter()
  const { user } = useUser()
  const [items, setItems] = useState<BidProject[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('created_desc')

  const load = useCallback(() => {
    setFailed(false)
    setItems(null)
    bidApis
      .listProjects()
      .then(setItems)
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (e: React.MouseEvent, p: BidProject) => {
    e.stopPropagation()
    if (!window.confirm(t('projects.delete_confirm', { title: p.title }))) return
    await bidApis.deleteProject(p.id)
    setItems(prev => (prev ? prev.filter(x => x.id !== p.id) : prev))
  }

  // Client-side search (by name), status filter, and created-time sort over the
  // loaded list (small enough that server-side paging isn't warranted).
  const visible = useMemo(() => {
    if (!items) return items
    const q = query.trim().toLowerCase()
    const filtered = items.filter(p => {
      const matchesQuery = !q || (p.title || '').toLowerCase().includes(q)
      const matchesStatus = status === 'all' || statusKey(p) === status
      return matchesQuery && matchesStatus
    })
    return [...filtered].sort((a, b) => {
      const av = a.created_at || ''
      const bv = b.created_at || ''
      return sort === 'created_desc' ? bv.localeCompare(av) : av.localeCompare(bv)
    })
  }, [items, query, status, sort])

  const ownerName = user?.real_name || user?.user_name || '—'
  const ownerRole = user?.department_name || t('projects.owner_role')
  const ownerInitial = ownerName.slice(0, 1).toUpperCase()

  const hasItems = !failed && items && items.length > 0

  // Shared trigger styling for the modern dropdowns (compact, white, warm border).
  const triggerCls =
    'h-9 w-auto min-w-[124px] gap-2 rounded-lg border-border bg-surface px-3 text-[13px] text-text-primary'

  return (
    <div className="flex h-full flex-col" data-testid="bid-project-list">
      {/* Top bar */}
      <div
        className="flex flex-shrink-0 items-center gap-4 px-7"
        style={{ height: 60, background: '#fff', borderBottom: '1px solid var(--bid-border)' }}
      >
        <button
          type="button"
          onClick={() => router.push('/chat')}
          data-testid="bid-back-platform-button"
          title={t('projects.back_to_platform')}
          className="flex items-center gap-1.5"
          style={{
            cursor: 'pointer',
            color: 'var(--bid-sub)',
            fontSize: 13,
            fontWeight: 600,
            padding: '7px 12px',
            border: '1px solid var(--bid-border-2)',
            borderRadius: 9,
          }}
        >
          <span style={{ fontSize: 15 }}>←</span>
          <span>{t('projects.back_to_platform')}</span>
        </button>
        <div style={{ width: 1, height: 22, background: 'var(--bid-border)' }} />
        <div
          className="flex items-center justify-center font-black text-white"
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: 'var(--bid-primary)',
            fontSize: 14,
          }}
        >
          标
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '.5px' }}>
          {t('projects.workbench_name')}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center"
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: '#F1EEEB',
              fontSize: 13,
            }}
          >
            {ownerInitial === '—' ? '👤' : ownerInitial}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--bid-ink-2)' }}>
              {ownerName}
            </div>
            <div style={{ fontSize: 10, color: 'var(--bid-muted-2)' }}>{ownerRole}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 32px 56px' }}>
          <div className="flex items-end justify-between" style={{ marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 23, fontWeight: 800, color: 'var(--bid-ink)' }}>
                {t('projects.title')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--bid-muted)', marginTop: 5 }}>
                {t('projects.subtitle')}
              </div>
            </div>
            <button
              type="button"
              onClick={onNew}
              data-testid="bid-new-project-button"
              className="flex-shrink-0 text-white"
              style={{
                background: 'var(--bid-primary)',
                borderRadius: 10,
                padding: '11px 20px',
                fontSize: 13.5,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px var(--bid-primary-soft)',
              }}
            >
              {t('projects.new_project')}
            </button>
          </div>

          {hasItems && (
            <div className="flex flex-wrap items-center gap-3" style={{ margin: '24px 0 20px' }}>
              <div className="relative" style={{ flex: 1, minWidth: 240, maxWidth: 420 }}>
                <span
                  className="absolute"
                  style={{
                    left: 13,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 13,
                    color: 'var(--bid-muted-3)',
                  }}
                >
                  🔍
                </span>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('projects.search_placeholder')}
                  data-testid="bid-project-search"
                  className="w-full"
                  style={{
                    boxSizing: 'border-box',
                    border: '1px solid var(--bid-border-2)',
                    borderRadius: 10,
                    padding: '11px 14px 11px 36px',
                    fontSize: 13,
                    outline: 'none',
                    background: '#fff',
                  }}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 12, color: 'var(--bid-muted-2)' }}>
                  {t('projects.status_label')}
                </span>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="bid-project-status-filter" className={triggerCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={bidThemeVars}>
                    {STATUS_FILTERS.map(s => (
                      <SelectItem key={s} value={s}>
                        {s === 'all' ? t('projects.all_status') : t(`projects.status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 12, color: 'var(--bid-muted-2)' }}>
                  {t('projects.sort_label')}
                </span>
                <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
                  <SelectTrigger data-testid="bid-project-sort" className={triggerCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={bidThemeVars}>
                    <SelectItem value="created_desc">{t('projects.sort_newest')}</SelectItem>
                    <SelectItem value="created_asc">{t('projects.sort_oldest')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div style={{ fontSize: 12, color: 'var(--bid-muted-2)', marginLeft: 'auto' }}>
                {t('projects.count', { count: visible ? visible.length : 0 })}
              </div>
            </div>
          )}

          {failed && (
            <div
              className="flex flex-col items-center gap-3 py-16"
              data-testid="bid-projects-error"
            >
              <div className="text-sm" style={{ color: 'var(--bid-primary)' }}>
                {t('projects.load_failed')}
              </div>
              <button
                type="button"
                onClick={load}
                data-testid="bid-projects-retry"
                className="rounded-lg px-4 py-2 text-sm"
                style={{ border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }}
              >
                {t('projects.retry')}
              </button>
            </div>
          )}

          {!failed && items === null && (
            <div
              className="py-16 text-center text-sm"
              style={{ color: 'var(--bid-muted)' }}
              data-testid="bid-projects-loading"
            >
              {t('projects.loading')}
            </div>
          )}

          {!failed && items && items.length === 0 && (
            <EmptyBox testid="bid-projects-empty" text={t('projects.empty')} />
          )}

          {hasItems && visible && visible.length === 0 && (
            <EmptyBox testid="bid-projects-no-match" text={t('projects.no_match')} />
          )}

          {hasItems && visible && visible.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {visible.map(p => {
                const sk = statusKey(p)
                const c = STATUS_COLORS[sk] || STATUS_COLORS.in_progress
                const gate = gateOf(p)
                const progress = p.current_phase >= 7 ? 100 : Math.round((gate / 6) * 100)
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(p)}
                    data-testid={`bid-project-card-${p.id}`}
                    className="group relative"
                    style={{
                      background: '#fff',
                      border: '1px solid var(--bid-border)',
                      borderRadius: 14,
                      padding: 18,
                      cursor: 'pointer',
                    }}
                  >
                    <button
                      type="button"
                      onClick={e => remove(e, p)}
                      data-testid={`bid-project-delete-${p.id}`}
                      title={t('projects.delete')}
                      className="absolute opacity-0 transition-opacity group-hover:opacity-100"
                      style={{
                        top: 8,
                        right: 8,
                        width: 24,
                        height: 24,
                        borderRadius: 7,
                        border: '1px solid var(--bid-border-2)',
                        background: '#fff',
                        fontSize: 12,
                        color: 'var(--bid-muted-2)',
                        cursor: 'pointer',
                      }}
                    >
                      🗑
                    </button>
                    <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                      <span
                        className="inline-flex items-center gap-1.5"
                        style={{
                          background: c.bg,
                          color: c.fg,
                          borderRadius: 999,
                          padding: '3px 10px',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        <span
                          style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot }}
                        />
                        {t(`projects.status.${sk}`)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--bid-muted-3)' }}>
                        {p.created_at?.slice(0, 10)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 15.5,
                        fontWeight: 800,
                        color: 'var(--bid-ink)',
                        lineHeight: 1.4,
                        marginBottom: 12,
                        minHeight: 44,
                      }}
                    >
                      {p.title}
                    </div>
                    <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
                      <span style={{ fontSize: 11, color: 'var(--bid-muted-2)' }}>
                        {t('projects.stage_text', { gate, phase: t(`projects.phase.${gate}`) })}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--bid-muted-2)' }}>{progress}%</span>
                    </div>
                    <div
                      style={{
                        height: 5,
                        background: '#EFE9E5',
                        borderRadius: 3,
                        overflow: 'hidden',
                        marginBottom: 14,
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${progress}%`,
                          background: 'var(--bid-primary)',
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <div
                      className="flex items-center justify-between"
                      style={{ paddingTop: 12, borderTop: '1px solid #F0EBE7' }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="flex items-center justify-center"
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: '#F1EEEB',
                            fontSize: 11,
                            color: 'var(--bid-sub)',
                            fontWeight: 700,
                          }}
                        >
                          {ownerInitial === '—' ? '👤' : ownerInitial}
                        </span>
                        <span style={{ fontSize: 11.5, color: 'var(--bid-sub)' }}>{ownerName}</span>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--bid-primary)', fontWeight: 700 }}>
                        {t('projects.open')}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyBox({ testid, text }: { testid: string; text: string }) {
  return (
    <div
      data-testid={testid}
      style={{
        border: '1.5px dashed var(--bid-border-2)',
        borderRadius: 16,
        padding: 64,
        textAlign: 'center',
        background: '#fff',
      }}
    >
      <div style={{ fontSize: 34, marginBottom: 12 }}>🗂</div>
      <div style={{ fontSize: 14, color: 'var(--bid-muted)' }}>{text}</div>
    </div>
  )
}
