// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import type { CoverageReport, OutlineDoc } from '@/apis/bid'
import { OutlineTree } from './OutlineTree'
import { CoveragePanel } from './CoveragePanel'

interface Props {
  outline: OutlineDoc
  coverage: CoverageReport
  onSave: (edited: OutlineDoc) => void
  onNext: () => void
}

export function OutlineEditor({ outline, coverage, onSave, onNext }: Props) {
  const { t } = useTranslation('bidWorkbench')
  const [draft, setDraft] = useState<OutlineDoc>(outline)
  const blocked = coverage.uncovered_scoring.length + coverage.uncovered_clauses.length > 0

  return (
    <div className="flex h-full gap-4 p-6" data-testid="bid-outline-editor">
      <section className="flex-1 overflow-auto">
        <h3 className="mb-2 text-sm font-semibold">{t('phase2.sections')}</h3>
        <OutlineTree
          nodes={draft.sections ?? []}
          onChange={s => setDraft({ ...draft, sections: s })}
        />
      </section>
      <section className="flex-1 overflow-auto">
        <h3 className="mb-2 text-sm font-semibold">{t('phase2.volumes')}</h3>
        <OutlineTree
          nodes={draft.volumes ?? []}
          onChange={v => setDraft({ ...draft, volumes: v })}
        />
      </section>
      <aside className="w-[280px] flex-shrink-0">
        <CoveragePanel coverage={coverage} />
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onSave(draft)}
            data-testid="outline-save-button"
            className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
          >
            {t('phase2.save')}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={blocked}
            data-testid="outline-next-button"
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {t('phase2.next')}
          </button>
        </div>
      </aside>
    </div>
  )
}
