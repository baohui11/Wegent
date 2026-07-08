// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { useTranslation } from '@/hooks/useTranslation'

interface SectionBubbleMenuProps {
  editor: Editor | null
  // Block-scoped AI action (subproject 🅑): regenerate the block the selection
  // sits in. Lives here (at the block) rather than in the section right panel so
  // AI scope maps to place — panel=section, bubble/handle=block, top bar=whole
  // doc. Called with an optional free-text instruction gathered from the ↻
  // popover (problem ③: rewrite must ask for requirements first, not fire
  // blind). Omitted → the ↻ action is not shown.
  onRegenerateBlock?: (instruction?: string) => void
}

// Quick-fill instruction chips for the ↻ popover (i18n keys; the translated
// text becomes the instruction sent to the backend rewrite).
const REGEN_CHIPS = [
  'editor.bubble.regen_chip_concise',
  'editor.bubble.regen_chip_tone',
  'editor.bubble.regen_chip_expand',
] as const

/**
 * On-selection formatting toolbar. Renders inside a Tiptap BubbleMenu so it
 * floats above the current text selection. Buttons cover the formats shown in
 * the reference mockup: headings (H2/H3), bold, italic, inline code, bullet /
 * ordered lists. Underline is omitted (StarterKit does not include it; would
 * need @tiptap/extension-underline — deferred). When `onRegenerateBlock` is
 * given, a trailing ↻ opens an instruction popover (chips + free text) that
 * regenerates the block ONLY on submit — the AI never rewrites silently (③).
 */
export function SectionBubbleMenu({ editor, onRegenerateBlock }: SectionBubbleMenuProps) {
  const { t } = useTranslation('bidWorkbench')
  // ↻ instruction popover state (open + current free-text instruction).
  const [regenOpen, setRegenOpen] = useState(false)
  const [instr, setInstr] = useState('')
  if (!editor) return null

  const btn = (testid: string, label: string, title: string, run: () => void) => (
    <button
      key={testid}
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

  const submitRegen = () => {
    onRegenerateBlock?.(instr.trim() || undefined)
    setRegenOpen(false)
    setInstr('')
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="bidFormatBubble"
      // Only while the editor is focused with a real (non-empty) text selection,
      // and never inside a table (table hover controls handle that). While the ↻
      // instruction popover is open we keep showing even though the editor loses
      // focus to the textarea — otherwise the popover would vanish mid-typing.
      shouldShow={({ editor, state }) =>
        editor.isEditable &&
        (editor.isFocused || regenOpen) &&
        !state.selection.empty &&
        !editor.isActive('table')
      }
    >
      <div className="flex flex-col items-stretch gap-1">
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
          {([2, 3, 4, 5] as const).map(level =>
            btn(
              `bid-bubble-h${level}`,
              t(`editor.bubble.h${level}`),
              t(`editor.bubble.h${level}`),
              () => editor.chain().focus().toggleHeading({ level }).run()
            )
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
              {btn('bid-bubble-regen', '↻', t('editor.bubble.regen'), () => setRegenOpen(o => !o))}
            </>
          )}
        </div>

        {/* ↻ instruction popover: chips + free text, regenerates ONLY on submit. */}
        {onRegenerateBlock && regenOpen && (
          <div
            data-testid="bid-bubble-regen-panel"
            className="flex flex-col gap-1.5 rounded-lg p-2"
            style={{
              background: '#fff',
              border: '1px solid var(--bid-border-2)',
              boxShadow: '0 4px 14px rgba(0,0,0,.12)',
              zIndex: 30,
            }}
          >
            <div className="flex flex-wrap gap-1">
              {REGEN_CHIPS.map((key, i) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`bid-bubble-regen-chip-${i}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => setInstr(t(key))}
                  className="rounded-full px-2 py-0.5 text-[11px]"
                  style={{ border: '1px solid var(--bid-border)', color: 'var(--bid-sub)' }}
                >
                  {t(key)}
                </button>
              ))}
            </div>
            <textarea
              data-testid="bid-bubble-regen-instruction"
              value={instr}
              onChange={e => setInstr(e.target.value)}
              placeholder={t('editor.bubble.regen_prompt')}
              rows={2}
              className="w-full resize-none rounded-md px-2 py-1 text-[12px] outline-none"
              // Explicit light surface: the popover is a white card, so the
              // textarea must not inherit a dark-theme black background/text.
              style={{
                border: '1px solid var(--bid-border-2)',
                background: '#fff',
                color: 'var(--bid-ink)',
              }}
            />
            <button
              type="button"
              data-testid="bid-bubble-regen-submit"
              onMouseDown={e => e.preventDefault()}
              onClick={submitRegen}
              className="self-end rounded-md px-3 py-1 text-[12px] font-semibold text-white"
              style={{ background: 'var(--bid-primary)' }}
            >
              {t('editor.bubble.regen_submit')}
            </button>
          </div>
        )}
      </div>
    </BubbleMenu>
  )
}
