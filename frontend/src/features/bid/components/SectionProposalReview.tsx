// SPDX-License-Identifier: Apache-2.0

'use client'

import ReactDiffViewer from 'react-diff-viewer-continued'
import { useTranslation } from '@/hooks/useTranslation'

interface SectionProposalReviewProps {
  sectionName: string
  // Pre-redraft snapshot (what discard reverts to).
  oldContent: string
  // Freshly regenerated content (already persisted, pending the user's call).
  newContent: string
  // The redraft is still running; there is no new content to diff yet.
  pending: boolean
  onAccept: () => void
  onDiscard: () => void
  onRetry: () => void
}

// 🅒 AI diff safety: an AI redraft no longer silently commits. This panel
// previews old→new and gates the change behind accept / discard / retry.
// Discard reverts to the pre-redraft snapshot (the parent writes it back via
// saveSection), so an unwanted rewrite never destroys the prior content.
export function SectionProposalReview({
  sectionName,
  oldContent,
  newContent,
  pending,
  onAccept,
  onDiscard,
  onRetry,
}: SectionProposalReviewProps) {
  const { t } = useTranslation('bidWorkbench')
  return (
    <div data-testid="bid-proposal-review">
      <div className="mb-2 truncate text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
        {t('editor.proposal.title')} · {sectionName}
      </div>

      {pending ? (
        <div
          className="flex items-center gap-2 text-[13px]"
          style={{ color: 'var(--bid-muted-2)', fontFamily: "'Noto Sans SC', sans-serif" }}
        >
          <span
            className="inline-block h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full"
            style={{ border: '2px solid #EEE6E4', borderTopColor: 'var(--bid-primary)' }}
          />
          {t('editor.proposal.regenerating')}
        </div>
      ) : (
        <>
          <div
            className="mb-2 max-h-[280px] overflow-auto rounded-md text-[12px]"
            style={{ border: '1px solid var(--bid-border)' }}
            data-testid="bid-proposal-diff"
          >
            <ReactDiffViewer oldValue={oldContent} newValue={newContent} splitView={false} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              data-testid="bid-proposal-discard"
              onClick={onDiscard}
              className="rounded-lg py-2 text-[11.5px] disabled:cursor-not-allowed"
              style={{ border: '1px solid var(--bid-border-2)', color: 'var(--bid-sub)' }}
            >
              {t('editor.proposal.discard')}
            </button>
            <button
              type="button"
              data-testid="bid-proposal-retry"
              onClick={onRetry}
              className="rounded-lg py-2 text-[11.5px]"
              style={{ border: '1px solid var(--bid-border-2)', color: 'var(--bid-sub)' }}
            >
              {t('editor.proposal.retry')}
            </button>
            <button
              type="button"
              data-testid="bid-proposal-accept"
              onClick={onAccept}
              className="rounded-lg py-2 text-[11.5px] font-bold text-white"
              style={{ background: 'var(--bid-primary)' }}
            >
              {t('editor.proposal.accept')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
