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
      className="flex h-full flex-col items-center justify-center px-6 py-10"
      style={{ background: 'radial-gradient(circle at 50% 0%, #FBEAEA 0%, #F7F6F4 55%)' }}
      data-testid="bid-upload-screen"
    >
      <div
        className="mb-[22px] flex h-16 w-16 items-center justify-center rounded-2xl text-[26px] font-black text-white"
        style={{ background: 'var(--bid-primary)' }}
      >
        标
      </div>
      <div className="mb-2 text-2xl font-extrabold" style={{ color: 'var(--bid-ink)' }}>
        {t('title')}
      </div>
      <div className="mb-9 text-sm" style={{ color: 'var(--bid-muted)' }}>
        {t('upload.subtitle')}
      </div>

      <div
        className="flex w-[560px] max-w-full flex-col gap-3.5 rounded-2xl p-8"
        style={{ border: '1.5px dashed #D9B7BB', background: '#fff' }}
      >
        <div className="text-center text-[34px] leading-none">📄</div>
        <div className="text-center text-sm" style={{ color: 'var(--bid-sub)' }}>
          {t('upload.dropzone')}
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t('upload.paste_placeholder')}
          data-testid="bid-tender-input"
          rows={7}
          className="w-full resize-y rounded-xl px-3 py-2 text-sm outline-none"
          style={{ border: '1px solid var(--bid-border-2)', background: 'var(--bid-paper-2)' }}
        />
        <div className="flex items-center gap-3">
          <label
            className="flex-shrink-0 cursor-pointer text-xs font-medium"
            style={{ color: 'var(--bid-primary)' }}
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
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{ border: '1px solid var(--bid-border-2)' }}
          />
        </div>
        <button
          type="button"
          onClick={() => onSubmit(text, pkg)}
          disabled={!text.trim()}
          data-testid="bid-start-parse-button"
          className="w-full rounded-[10px] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: 'var(--bid-primary)' }}
        >
          {t('upload.start')}
        </button>
        <div
          className="flex items-center justify-center gap-2 text-xs"
          style={{ color: 'var(--bid-muted-3)' }}
        >
          <span>{t('upload.or_sample')}</span>
          <button
            type="button"
            onClick={() => {
              setText(sampleText)
              onUseSample(pkg)
            }}
            data-testid="bid-upload-sample-button"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }}
          >
            {t('upload.use_sample')}
          </button>
        </div>
      </div>
    </div>
  )
}
