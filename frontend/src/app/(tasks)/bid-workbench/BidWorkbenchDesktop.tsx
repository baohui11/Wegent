// SPDX-License-Identifier: Apache-2.0

'use client'

import { useTranslation } from '@/hooks/useTranslation'
import { bidThemeVars } from '@/features/bid/theme'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { UploadScreen } from '@/features/bid/components/UploadScreen'
import { ParsingScreen } from '@/features/bid/components/ParsingScreen'
import { TenderResultView } from '@/features/bid/components/TenderResultView'

const SAMPLE_TENDER = '（示例招标正文占位——真实流程由上传或后端示例项目提供）'

export function BidWorkbenchDesktop() {
  const { t } = useTranslation('bidWorkbench')
  const { phase, tender, error, startFromText, reset } = useBidProject()

  return (
    <div style={bidThemeVars} className="h-full bg-base" data-testid="bid-workbench-desktop">
      {(phase === 'idle' || phase === 'creating') && (
        <UploadScreen onUseSample={() => startFromText(SAMPLE_TENDER)} />
      )}
      {phase === 'parsing' && <ParsingScreen />}
      {phase === 'ready' && tender && <TenderResultView tender={tender} />}
      {phase === 'error' && (
        <div
          className="flex h-full flex-col items-center justify-center gap-4"
          data-testid="bid-error"
        >
          <div className="text-sm text-error">{t('errors.parse_failed')}</div>
          {error && <div className="text-xs text-text-muted">{error}</div>}
          <button
            type="button"
            onClick={reset}
            data-testid="bid-retry-button"
            className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
          >
            {t('upload.use_sample')}
          </button>
        </div>
      )}
    </div>
  )
}
