// SPDX-License-Identifier: Apache-2.0

'use client'

import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { useTranslation } from '@/hooks/useTranslation'

interface SectionBubbleMenuProps {
  editor: Editor | null
  // Block-scoped AI action (subproject 🅑): regenerate the block the selection
  // sits in. Lives here (at the block) rather than in the section right panel so
  // AI scope maps to place — panel=section, bubble/handle=block, top bar=whole
  // doc. Omitted → the ↻ action is not shown.
  onRegenerateBlock?: () => void
}

/**
 * On-selection formatting toolbar. Renders inside a Tiptap BubbleMenu so it
 * floats above the current text selection. Buttons cover the formats shown in
 * the reference mockup: headings (H2/H3), bold, italic, inline code, bullet /
 * ordered lists. Underline is omitted (StarterKit does not include it; would
 * need @tiptap/extension-underline — deferred). When `onRegenerateBlock` is
 * given, a trailing ↻ offers block-level AI regeneration (🅑 scope split).
 */
export function SectionBubbleMenu({ editor, onRegenerateBlock }: SectionBubbleMenuProps) {
  const { t } = useTranslation('bidWorkbench')
  if (!editor) return null

  const btn = (testid: string, label: string, title: string, run: () => void) => (
    <button
      type="button"
      data-testid={testid}
      title={title}
      aria-label={title}
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
    <BubbleMenu
      editor={editor}
      pluginKey="bidFormatBubble"
      // Only while the editor is focused with a real (non-empty) text selection,
      // and never inside a table (table hover controls handle that). The focus +
      // non-empty guards keep it from lingering on entering edit mode.
      shouldShow={({ editor, state }) =>
        editor.isEditable && editor.isFocused && !state.selection.empty && !editor.isActive('table')
      }
    >
      <div
        className="flex items-center gap-0.5 rounded-lg px-1.5 py-1"
        style={{
          background: '#fff',
          border: '1px solid var(--bid-border-2)',
          boxShadow: '0 4px 14px rgba(0,0,0,.12)',
          // Below the block-insert dropdown (40), above the drag handle.
          zIndex: 30,
        }}
        data-testid="bid-bubble-toolbar"
      >
        {btn('bid-bubble-h2', t('editor.bubble.h2'), t('editor.bubble.h2'), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        )}
        {btn('bid-bubble-h3', t('editor.bubble.h3'), t('editor.bubble.h3'), () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        )}
        {btn('bid-bubble-bold', 'B', t('editor.bubble.bold'), () =>
          editor.chain().focus().toggleBold().run()
        )}
        {btn('bid-bubble-italic', 'I', t('editor.bubble.italic'), () =>
          editor.chain().focus().toggleItalic().run()
        )}
        {btn('bid-bubble-code', '</>', t('editor.bubble.code'), () =>
          editor.chain().focus().toggleCode().run()
        )}
        {btn('bid-bubble-bullet', '•', t('editor.bubble.bullet'), () =>
          editor.chain().focus().toggleBulletList().run()
        )}
        {btn('bid-bubble-ordered', '1.', t('editor.bubble.ordered'), () =>
          editor.chain().focus().toggleOrderedList().run()
        )}
        {onRegenerateBlock && (
          <>
            <span
              aria-hidden
              className="mx-0.5 h-4 w-px"
              style={{ background: 'var(--bid-border-2)' }}
            />
            {btn('bid-bubble-regen', '↻', t('editor.bubble.regen'), onRegenerateBlock)}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
