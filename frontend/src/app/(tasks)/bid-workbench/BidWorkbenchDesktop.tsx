// SPDX-License-Identifier: Apache-2.0

'use client'

import { useTranslation } from '@/hooks/useTranslation'
import { bidThemeVars } from '@/features/bid/theme'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { UploadScreen } from '@/features/bid/components/UploadScreen'
import { ParsingScreen } from '@/features/bid/components/ParsingScreen'
import { TenderResultView } from '@/features/bid/components/TenderResultView'
import { OutlineEditor } from '@/features/bid/components/OutlineEditor'

const SAMPLE_TENDER = '（示例招标正文占位——真实流程由上传或后端示例项目提供）'

export function BidWorkbenchDesktop() {
  const { t } = useTranslation('bidWorkbench')
  const {
    phase,
    tender,
    outline,
    coverage,
    error,
    startFromText,
    buildOutline,
    saveOutline,
    reset,
  } = useBidProject()

  return (
    <div style={bidThemeVars} className="h-full bg-base" data-testid="bid-workbench-desktop">
      {(phase === 'idle' || phase === 'creating') && (
        <UploadScreen onUseSample={pkg => startFromText(SAMPLE_TENDER, pkg || undefined)} />
      )}
      {phase === 'parsing' && <ParsingScreen />}
      {phase === 'ready' && tender && (
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-auto">
            <TenderResultView tender={tender} />
          </div>
          <div className="border-t border-border p-4 text-right">
            <button
              type="button"
              onClick={buildOutline}
              data-testid="bid-build-outline-button"
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white"
            >
              {t('phase2.build')}
            </button>
          </div>
        </div>
      )}
      {phase === 'outline_building' && <ParsingScreen />}
      {phase === 'outline_ready' && outline && coverage && (
        <OutlineEditor
          outline={outline}
          coverage={coverage}
          onSave={saveOutline}
          onNext={() => {}}
        />
      )}
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
