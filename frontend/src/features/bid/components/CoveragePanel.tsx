// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from '@/hooks/useTranslation'
import type { CoverageReport } from '@/apis/bid'

export function CoveragePanel({ coverage }: { coverage: CoverageReport }) {
  const { t } = useTranslation('bidWorkbench')
  const missing = [...coverage.uncovered_scoring, ...coverage.uncovered_clauses]
  return (
    <div className="rounded-lg border border-border p-4" data-testid="bid-coverage-panel">
      <div className="mb-2 text-sm font-semibold">
        {t('phase2.coverage')} {coverage.covered}/{coverage.total}
      </div>
      {missing.length === 0 ? (
        <div className="text-sm text-success" data-testid="coverage-clean">
          {t('phase2.coverage_ok')}
        </div>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {coverage.uncovered_scoring.map(id => (
            <li key={id} className="text-error" data-testid={`uncovered-${id}`}>
              {t('phase2.uncovered_scoring')}: {id}
            </li>
          ))}
          {coverage.uncovered_clauses.map(id => (
            <li key={id} className="text-error" data-testid={`uncovered-${id}`}>
              ★ {id}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
