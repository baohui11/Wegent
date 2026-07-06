// SPDX-License-Identifier: Apache-2.0
'use client'

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useTranslation } from '@/hooks/useTranslation'

// Renders ONE bid section: a title bar (the outline name, ONCE — the body
// markdown no longer carries its heading, see spike-notes §6) plus a status
// pill. The body is the editable region. While the section is being
// (re)drafted we lock `contentEditable` so an async LLM rewrite never races a
// manual edit. The title comes from the editor option `sectionNames`
// (sectionId -> outline name) injected by the BidDocumentEditor.
export function BidSectionNodeView({ node, extension }: ReactNodeViewProps) {
  const { t } = useTranslation('bidWorkbench')
  const sid = String(node.attrs.sectionId ?? '')
  const status = String(node.attrs.status ?? 'pending')
  const accepted = Boolean(node.attrs.accepted)
  const names = (extension.options.sectionNames ?? {}) as Record<string, string>
  const title = names[sid] || sid
  const locked = status === 'drafting'

  return (
    <NodeViewWrapper
      className="mb-8 bid-section-chrome"
      data-testid={`bid-section-${sid}`}
      data-bid-section={sid}
    >
      <div
        className="mb-3.5 flex items-baseline justify-between border-b pb-2"
        style={{ borderColor: 'var(--bid-border)' }}
      >
        <div
          className="text-base font-bold"
          style={{ color: 'var(--bid-ink)', fontFamily: "'Noto Sans SC', sans-serif" }}
        >
          {title}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {accepted && (
            <span style={{ color: 'var(--bid-success)' }} aria-label="accepted">
              ✓
            </span>
          )}
          {status !== 'done' && (
            <span
              className="whitespace-nowrap rounded-md px-2 py-0.5 text-[11px]"
              style={{
                background: 'var(--bid-paper)',
                color: 'var(--bid-muted-2)',
                fontFamily: "'Noto Sans SC', sans-serif",
              }}
              data-testid={`bid-section-status-${sid}`}
            >
              {t(`phase4.status_${status}`)}
            </span>
          )}
        </div>
      </div>
      <NodeViewContent
        as="div"
        className="bid-prose"
        data-testid={`bid-section-content-${sid}`}
        contentEditable={!locked}
      />
    </NodeViewWrapper>
  )
}
