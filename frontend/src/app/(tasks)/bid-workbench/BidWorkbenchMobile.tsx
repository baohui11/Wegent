// SPDX-License-Identifier: Apache-2.0

'use client'

import { useTranslation } from '@/hooks/useTranslation'

export function BidWorkbenchMobile() {
  const { t } = useTranslation('bidWorkbench')
  return (
    <div className="p-6 text-sm text-text-secondary" data-testid="bid-workbench-mobile">
      {t('title')}
    </div>
  )
}
