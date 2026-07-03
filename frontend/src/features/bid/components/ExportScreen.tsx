// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis } from '@/apis/bid'

// Static typography preview options (assembly currently uses a fixed template;
// per-export typography settings have no backend yet — shown as a preview).
const PAGE_OPTS = ['A4 (210×297mm)', 'A3', 'Letter']
const MARGIN_OPTS = ['标准 (2.54cm)', '窄 (1.27cm)', '宽 (3.18cm)']
const FONT_CN_OPTS = ['思源宋体', '仿宋', '黑体']
const FONT_SIZE_OPTS = ['小四 (12pt)', '五号 (10.5pt)', '四号 (14pt)']

function Select({ label, options }: { label: string; options: string[] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
        {label}
      </span>
      <select
        disabled
        className="rounded-lg px-3 py-2 text-sm disabled:opacity-80"
        style={{ border: '1px solid var(--bid-border-2)', background: 'var(--bid-paper-2)' }}
      >
        {options.map(o => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

export function ExportScreen({
  projectId,
  onReaudit,
}: {
  projectId: number
  onReaudit: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cover, setCover] = useState('std')

  const download = async () => {
    setError(null)
    setDownloading(true)
    try {
      await bidApis.downloadBid(projectId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="flex h-full gap-6 overflow-auto p-6"
      style={{ background: 'var(--bid-paper)' }}
      data-testid="bid-export-screen"
    >
      {/* Left: typography preview */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div
          className="flex items-center gap-3 rounded-2xl p-5"
          style={{ background: 'var(--bid-success-soft)', border: '1px solid var(--bid-success)' }}
        >
          <span className="text-lg" style={{ color: 'var(--bid-success)' }}>
            ✓
          </span>
          <span className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
            {t('phase6.done')}
          </span>
        </div>

        <div
          className="flex flex-col gap-4 rounded-2xl p-5"
          style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
        >
          <div className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
            {t('export.typography')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('export.page')} options={PAGE_OPTS} />
            <Select label={t('export.margin')} options={MARGIN_OPTS} />
            <Select label={t('export.font_cn')} options={FONT_CN_OPTS} />
            <Select label={t('export.font_size')} options={FONT_SIZE_OPTS} />
          </div>

          <div className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
            {t('export.cover')}
          </div>
          <div className="flex gap-3">
            {[
              { id: 'std', label: t('export.cover_std'), bg: 'var(--bid-primary)' },
              { id: 'dark', label: t('export.cover_dark'), bg: 'var(--bid-ink)' },
              { id: 'light', label: t('export.cover_light'), bg: 'var(--bid-primary-soft)' },
            ].map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCover(c.id)}
                className="flex w-24 flex-col items-center gap-1.5 rounded-xl p-2"
                style={{
                  border:
                    cover === c.id
                      ? '2px solid var(--bid-primary)'
                      : '1px solid var(--bid-border-2)',
                }}
              >
                <span className="h-12 w-full rounded-md" style={{ background: c.bg }} />
                <span className="text-[11px]" style={{ color: 'var(--bid-sub)' }}>
                  {c.label}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            {['toc_auto', 'toc_page', 'toc_fig'].map(k => (
              <label
                key={k}
                className="flex items-center gap-2 text-sm"
                style={{ color: 'var(--bid-sub)' }}
              >
                <input type="checkbox" defaultChecked disabled />
                {t(`export.${k}`)}
              </label>
            ))}
          </div>
          <div className="text-xs" style={{ color: 'var(--bid-muted-2)' }}>
            {t('export.settings_note')}
          </div>
        </div>
      </div>

      {/* Right: export actions */}
      <div className="flex w-[280px] flex-shrink-0 flex-col gap-3">
        <div className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
          {t('export.export_title')}
        </div>
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          data-testid="bid-download-button"
          className="rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
          style={{ background: 'var(--bid-primary)' }}
        >
          {downloading ? t('phase6.downloading') : t('phase6.download')}
        </button>
        <button
          type="button"
          disabled
          className="rounded-xl px-5 py-3 text-sm disabled:opacity-60"
          style={{
            background: '#fff',
            border: '1px solid var(--bid-border-2)',
            color: 'var(--bid-sub)',
          }}
        >
          {t('export.pdf')} · {t('export.soon')}
        </button>
        <button
          type="button"
          disabled
          className="rounded-xl px-5 py-3 text-sm disabled:opacity-60"
          style={{
            background: '#fff',
            border: '1px solid var(--bid-border-2)',
            color: 'var(--bid-sub)',
          }}
        >
          {t('export.zip')} · {t('export.soon')}
        </button>
        {error && (
          <div
            className="text-xs"
            style={{ color: 'var(--bid-primary)' }}
            data-testid="bid-download-error"
          >
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={onReaudit}
          data-testid="bid-reaudit-button"
          className="mt-2 text-xs underline"
          style={{ color: 'var(--bid-muted-2)' }}
        >
          {t('phase6.back_to_audit')}
        </button>
      </div>
    </div>
  )
}
