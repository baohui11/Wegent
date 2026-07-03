// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis } from '@/apis/bid'

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
      className="flex h-full flex-col items-center justify-center gap-4"
      data-testid="bid-export-screen"
    >
      <div className="text-sm text-text-secondary">{t('phase6.done')} ✓</div>
      <button
        type="button"
        onClick={download}
        disabled={downloading}
        data-testid="bid-download-button"
        className="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {downloading ? t('phase6.downloading') : t('phase6.download')}
      </button>
      {error && (
        <div className="text-xs text-error" data-testid="bid-download-error">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={onReaudit}
        data-testid="bid-reaudit-button"
        className="text-xs text-text-muted underline"
      >
        {t('phase6.back_to_audit')}
      </button>
    </div>
  )
}
