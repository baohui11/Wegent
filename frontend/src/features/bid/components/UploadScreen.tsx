// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

export function UploadScreen({ onUseSample }: { onUseSample: (pkg: string) => void }) {
  const { t } = useTranslation('bidWorkbench')
  const [pkg, setPkg] = useState('')
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-6"
      data-testid="bid-upload-screen"
    >
      <div className="text-2xl font-bold">{t('title')}</div>
      <div className="text-sm text-text-secondary">{t('upload.subtitle')}</div>
      <div className="w-[520px] rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
        <div className="mb-3 text-3xl">📄</div>
        <div className="mb-4 text-sm text-text-secondary">{t('upload.dropzone')}</div>
        <input
          value={pkg}
          onChange={e => setPkg(e.target.value)}
          placeholder={t('upload.package_label')}
          data-testid="bid-package-input"
          className="mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => onUseSample(pkg)}
          data-testid="bid-upload-sample-button"
          className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white"
        >
          {t('upload.use_sample')}
        </button>
      </div>
    </div>
  )
}
