// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from '@/hooks/useTranslation'

export function UploadScreen({ onUseSample }: { onUseSample: () => void }) {
  const { t } = useTranslation('bidWorkbench')
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
        <button
          type="button"
          onClick={onUseSample}
          data-testid="bid-upload-sample-button"
          className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white"
        >
          {t('upload.use_sample')}
        </button>
      </div>
    </div>
  )
}
