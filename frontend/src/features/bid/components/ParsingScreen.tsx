// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from '@/hooks/useTranslation'

export function ParsingScreen() {
  const { t } = useTranslation('bidWorkbench')
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-5"
      data-testid="bid-parsing-screen"
    >
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-border border-t-primary" />
      <div className="text-base font-semibold">{t('parsing.title')}</div>
    </div>
  )
}
