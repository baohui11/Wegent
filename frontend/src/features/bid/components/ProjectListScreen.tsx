// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
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

export function ProjectListScreen({
  onOpen,
  onNew,
}: {
  onOpen: (p: BidProject) => void
  onNew: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [items, setItems] = useState<BidProject[] | null>(null)
  const [failed, setFailed] = useState(false)

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

  const remove = async (p: BidProject) => {
    if (!window.confirm(t('projects.delete_confirm', { title: p.title }))) return
    await bidApis.deleteProject(p.id)
    setItems(prev => (prev ? prev.filter(x => x.id !== p.id) : prev))
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-6" data-testid="bid-project-list">
      <div className="mb-6 flex items-center justify-between">
        <div className="text-xl font-semibold">{t('projects.title')}</div>
        <button
          type="button"
          onClick={onNew}
          data-testid="bid-new-project-button"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          {t('projects.new')}
        </button>
      </div>

      {failed && (
        <div className="flex flex-col items-center gap-3 py-16" data-testid="bid-projects-error">
          <div className="text-sm text-error">{t('projects.load_failed')}</div>
          <button
            type="button"
            onClick={load}
            data-testid="bid-projects-retry"
            className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
          >
            {t('projects.retry')}
          </button>
        </div>
      )}

      {!failed && items === null && (
        <div
          className="py-16 text-center text-sm text-text-muted"
          data-testid="bid-projects-loading"
        >
          {t('projects.loading')}
        </div>
      )}

      {!failed && items && items.length === 0 && (
        <div
          className="py-16 text-center text-sm text-text-secondary"
          data-testid="bid-projects-empty"
        >
          {t('projects.empty')}
        </div>
      )}

      {!failed && items && items.length > 0 && (
        <ul className="flex flex-col gap-2 overflow-auto">
          {items.map(p => (
            <li key={p.id} className="group flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => onOpen(p)}
                data-testid={`bid-project-card-${p.id}`}
                className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-text-muted">
                    {t('projects.created_at')} {p.created_at?.slice(0, 10)}
                  </div>
                </div>
                <span className="rounded-md bg-base px-2 py-1 text-xs text-text-secondary">
                  {gateOf(p)} · {t(`projects.phase.${gateOf(p)}`)}
                </span>
                <span className="text-xs text-primary">{t(`projects.status.${statusKey(p)}`)}</span>
              </button>
              <button
                type="button"
                onClick={() => remove(p)}
                data-testid={`bid-project-delete-${p.id}`}
                title={t('projects.delete')}
                className="flex-shrink-0 rounded-xl border border-border px-3 text-sm text-text-muted opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
