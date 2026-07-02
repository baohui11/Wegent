// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from '@/hooks/useTranslation'
import type { TenderDoc } from '@/apis/bid'

export function TenderResultView({ tender }: { tender: TenderDoc }) {
  const { t } = useTranslation('bidWorkbench')
  const scoring = tender.scoring ?? []
  const redLines = (tender.mandatory_clauses ?? []).filter(c => c.veto)
  const pkg = tender.target_package

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="bid-tender-result">
      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('phase1.scoring')}</h2>
        <table className="w-full text-sm" data-testid="bid-scoring-table">
          <thead className="text-text-muted">
            <tr>
              <th className="text-left">{t('phase1.col_id')}</th>
              <th className="text-left">{t('phase1.col_weight')}</th>
              <th className="text-left">{t('phase1.col_section')}</th>
            </tr>
          </thead>
          <tbody>
            {scoring.map((s, i) => (
              <tr key={s.id ?? i} className="border-t border-border">
                <td>{s.id}</td>
                <td>{s.weight}</td>
                <td>{s.target_section}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-error">{t('phase1.clauses')}</h2>
        <ul className="flex flex-col gap-2 text-sm" data-testid="bid-redline-list">
          {redLines.map((c, i) => (
            <li key={c.id ?? i} className="rounded-md border border-border p-2">
              <span className="mr-2 text-error">★ {c.id}</span>
              {c.text}
            </li>
          ))}
        </ul>
      </section>

      {pkg && (
        <section data-testid="bid-package">
          <h2 className="mb-2 text-lg font-semibold">{t('phase1.package')}</h2>
          <div className="text-sm text-text-secondary">{pkg.tech_rubric_code}</div>
        </section>
      )}
    </div>
  )
}
