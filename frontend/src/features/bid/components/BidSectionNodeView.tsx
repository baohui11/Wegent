// SPDX-License-Identifier: Apache-2.0
'use client'

import { useState } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useTranslation } from '@/hooks/useTranslation'

// Renders ONE bid section: a click-to-edit title bar (the chapter title, ONCE —
// the body markdown no longer carries its heading, see spike-notes §6) plus a
// status pill. The body is the editable region. While the section is being
// (re)drafted we lock `contentEditable` so an async LLM rewrite never races a
// manual edit. The title comes from the section's `title` attr (injected from
// the outline); editing it persists back to the outline via the rename ref.
export function BidSectionNodeView({ node, updateAttributes, extension }: ReactNodeViewProps) {
  const { t } = useTranslation('bidWorkbench')
  const sid = String(node.attrs.sectionId ?? '')
  const status = String(node.attrs.status ?? 'pending')
  const accepted = Boolean(node.attrs.accepted)
  const names = (extension.options.sectionNames ?? {}) as Record<string, string>
  const renameRef = extension.options.onRenameSectionRef as
    | { current: ((sectionId: string, title: string) => void) | null }
    | undefined
  const title = String(node.attrs.title || names[sid] || sid)
  const locked = status === 'drafting'

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  const startEdit = () => {
    if (locked) return
    setDraft(title)
    setEditing(true)
  }
  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (!next || next === title) return
    updateAttributes({ title: next }) // instant local update
    renameRef?.current?.(sid, next) // persist to the outline (single source)
  }

  return (
    <NodeViewWrapper
      className="mb-8 bid-section-chrome"
      data-testid={`bid-section-${sid}`}
      data-bid-section={sid}
    >
      {/* Chrome (title + status) is NOT part of the editable body — mark it so
          ProseMirror never takes over the title input. */}
      <div
        className="mb-3.5 flex items-baseline justify-between border-b pb-2"
        style={{ borderColor: 'var(--bid-border)' }}
        contentEditable={false}
      >
        {editing ? (
          <input
            autoFocus
            data-testid={`bid-section-title-input-${sid}`}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
              }
            }}
            onMouseDown={e => e.stopPropagation()}
            className="min-w-0 flex-1 rounded px-1 py-0.5 text-base font-bold outline-none"
            style={{
              color: 'var(--bid-ink)',
              fontFamily: "'Noto Sans SC', sans-serif",
              background: '#fff',
              border: '1px solid var(--bid-primary)',
            }}
          />
        ) : (
          <div
            className={`text-base font-bold ${locked ? '' : 'cursor-text'}`}
            style={{ color: 'var(--bid-ink)', fontFamily: "'Noto Sans SC', sans-serif" }}
            data-testid={`bid-section-title-${sid}`}
            title={locked ? undefined : t('editor.rename_hint')}
            onClick={startEdit}
          >
            {title}
          </div>
        )}
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
