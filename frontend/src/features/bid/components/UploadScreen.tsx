// SPDX-License-Identifier: Apache-2.0

import { useState, type ChangeEvent } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

export function UploadScreen({
  onSubmit,
  onUseSample,
  sampleText,
}: {
  onSubmit: (tenderText: string, pkg: string) => void
  onUseSample: (pkg: string) => void
  sampleText: string
}) {
  const { t } = useTranslation('bidWorkbench')
  const [text, setText] = useState('')
  const [pkg, setPkg] = useState('')

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then(setText)
  }

  return (
    <div
      className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 p-6"
      data-testid="bid-upload-screen"
    >
      <div className="text-sm text-text-secondary">{t('upload.subtitle')}</div>
      <div className="w-full rounded-2xl border border-border bg-surface p-6">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t('upload.paste_placeholder')}
          data-testid="bid-tender-input"
          rows={10}
          className="mb-3 w-full resize-y rounded-lg border border-border bg-base px-3 py-2 text-sm"
        />
        <div className="mb-3 flex items-center gap-3">
          <label
            className="cursor-pointer text-xs text-primary"
            data-testid="bid-tender-file-label"
          >
            {t('upload.file_label')}
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              onChange={onFile}
              data-testid="bid-tender-file"
              className="hidden"
            />
          </label>
          <input
            value={pkg}
            onChange={e => setPkg(e.target.value)}
            placeholder={t('upload.package_label')}
            data-testid="bid-package-input"
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => onSubmit(text, pkg)}
          disabled={!text.trim()}
          data-testid="bid-start-parse-button"
          className="w-full rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t('upload.start')}
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span>{t('upload.or_sample')}</span>
        <button
          type="button"
          onClick={() => {
            setText(sampleText)
            onUseSample(pkg)
          }}
          data-testid="bid-upload-sample-button"
          className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
        >
          {t('upload.use_sample')}
        </button>
      </div>
    </div>
  )
}
