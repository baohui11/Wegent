// SPDX-License-Identifier: Apache-2.0

'use client'

import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { useTranslation } from '@/hooks/useTranslation'

interface SectionBubbleMenuProps {
  editor: Editor | null
}

/**
 * On-selection formatting toolbar. Renders inside a Tiptap BubbleMenu so it
 * floats above the current text selection. Buttons cover the formats shown in
 * the reference mockup: headings (H2/H3), bold, italic, inline code, bullet /
 * ordered lists. Underline is omitted (StarterKit does not include it; would
 * need @tiptap/extension-underline — deferred).
 */
export function SectionBubbleMenu({ editor }: SectionBubbleMenuProps) {
  const { t } = useTranslation('bidWorkbench')
  if (!editor) return null

  const btn = (testid: string, label: string, run: () => void) => (
    <button
      type="button"
      data-testid={testid}
      // Prevent the selection from collapsing when the button is clicked.
      onMouseDown={e => e.preventDefault()}
      onClick={run}
      className="bubble-btn rounded px-1.5 py-0.5 text-[12px]"
      style={{ color: 'var(--bid-ink-2)' }}
    >
      {label}
    </button>
  )

  return (
    <BubbleMenu editor={editor}>
      <div
        className="flex items-center gap-0.5 rounded-lg px-1.5 py-1"
        style={{
          background: '#fff',
          border: '1px solid var(--bid-border-2)',
          boxShadow: '0 4px 14px rgba(0,0,0,.12)',
        }}
        data-testid="bid-bubble-toolbar"
      >
        {btn('bid-bubble-h2', t('editor.bubble.h2'), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        )}
        {btn('bid-bubble-h3', t('editor.bubble.h3'), () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        )}
        {btn('bid-bubble-bold', 'B', () => editor.chain().focus().toggleBold().run())}
        {btn('bid-bubble-italic', 'I', () => editor.chain().focus().toggleItalic().run())}
        {btn('bid-bubble-code', '</>', () => editor.chain().focus().toggleCode().run())}
        {btn('bid-bubble-bullet', '•', () => editor.chain().focus().toggleBulletList().run())}
        {btn('bid-bubble-ordered', '1.', () => editor.chain().focus().toggleOrderedList().run())}
      </div>
    </BubbleMenu>
  )
}
