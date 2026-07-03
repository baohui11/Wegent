// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from '@/hooks/useTranslation'

const STEP_KEYS = ['ocr', 'toc', 'classify', 'tree'] as const

export function ParsingScreen() {
  const { t } = useTranslation('bidWorkbench')
  return (
    <div
      className="flex h-full flex-col items-center justify-center"
      style={{ background: 'var(--bid-paper)' }}
      data-testid="bid-parsing-screen"
    >
      <div
        className="mb-[26px] h-10 w-10 rounded-full"
        style={{
          border: '3px solid #EEE6E4',
          borderTopColor: 'var(--bid-primary)',
          animation: 'spin 0.9s linear infinite',
        }}
      />
      <div className="mb-[22px] text-base font-bold" style={{ color: 'var(--bid-ink)' }}>
        {t('parsing.title')}
      </div>
      <div className="flex w-[420px] max-w-full flex-col gap-3">
        {STEP_KEYS.map(k => (
          <div
            key={k}
            className="flex items-center gap-2.5 text-[13.5px]"
            style={{ color: 'var(--bid-sub)' }}
          >
            <span style={{ color: 'var(--bid-primary)' }}>◍</span>
            <span>{t(`parsingSteps.${k}`)}</span>
          </div>
        ))}
      </div>
      <div
        className="mt-[22px] h-1 w-[420px] max-w-full overflow-hidden rounded-full"
        style={{ background: '#EEE6E4' }}
      >
        <div
          className="h-full w-1/3 rounded-full"
          style={{
            background: 'var(--bid-primary)',
            animation: 'shimmer 1.4s ease-in-out infinite',
          }}
        />
      </div>
    </div>
  )
}
