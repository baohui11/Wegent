// SPDX-License-Identifier: Apache-2.0

'use client'

import { Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { useSectionAutosave } from '../hooks/useSectionAutosave'
import { SectionBubbleMenu } from './SectionBubbleMenu'

// API exposed to the parent (GenerateRefineScreen): the live editor instance
// (for paragraph-level block targeting) and a flush that resolves to the
// post-save version (the on-disk CAS token).
export interface SectionEditorApi {
  editor: Editor | null
  flush: () => Promise<string>
}

interface SectionEditorProps {
  projectId: number
  sectionId: string
  content: string
  version: string
  readOnly: boolean
  onSaved: (sectionId: string, version: string) => void
  /** Editor gained focus — parent tracks the active section. */
  onFocus?: (sectionId: string) => void
  /** Mounted and ready — parent gets the editor + flush for block regen. */
  onReady?: (sectionId: string, api: SectionEditorApi) => void
}

// The tiptap-markdown extension populates editor.storage.markdown.getMarkdown().
// It ships only runtime types, so declare a minimal surface for the editor we
// consume here instead of reaching for `any`.
interface MarkdownStorage {
  getMarkdown(): string
}

function markdownOf(editor: Editor | null): string {
  if (!editor) return ''
  const storage = (editor.storage ?? {}) as { markdown?: MarkdownStorage }
  return storage.markdown?.getMarkdown() ?? ''
}

export function SectionEditor({
  projectId,
  sectionId,
  content,
  version,
  readOnly,
  onSaved,
  onFocus,
  onReady,
}: SectionEditorProps) {
  const { t } = useTranslation('bidWorkbench')

  // SectionEditor owns its autosave so each editable section persists
  // independently (Edit mode can mount many editors at once).
  const autosave = useSectionAutosave({ projectId, sectionId, version, onSaved })

  // Gate autosave so it only fires on a genuine user edit. tiptap-markdown
  // re-normalizes content on mount, which emits an update; without this guard
  // merely entering Edit mode would PUT every section (and clear its accepted
  // flag). Flipped true on first focus, reset on each programmatic re-seed.
  const userEditedRef = useRef(false)

  const editor = useEditor({
    editable: !readOnly,
    content,
    extensions: [
      // StarterKit 3 already bundles Link; configure it here instead of adding
      // a second Link extension (which warns "Duplicate extension names: link").
      StarterKit.configure({ link: { openOnClick: false } }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    onUpdate: ({ editor }) => {
      if (!userEditedRef.current) return
      autosave.queueSave(markdownOf(editor))
    },
    onFocus: () => {
      userEditedRef.current = true
      onFocus?.(sectionId)
    },
    // Flush any pending edit when the editor loses focus so the on-disk bytes
    // match the editor before downstream operations (focus switch / redraft).
    onBlur: () => {
      void autosave.flush()
    },
    // Avoid SSR hydration mismatch — render the editor only on the client.
    immediatelyRender: false,
  })

  // Re-seed when a redraft replaces the content or the section changes.
  useEffect(() => {
    if (!editor) return
    if (content !== markdownOf(editor)) {
      userEditedRef.current = false // programmatic re-seed, not a user edit
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [readOnly, editor])

  // Hand the editor + flush to the parent for paragraph-level regeneration.
  useEffect(() => {
    if (editor) onReady?.(sectionId, { editor, flush: autosave.flush })
  }, [editor, sectionId, onReady, autosave.flush])

  return (
    <div className="bid-prose">
      {!readOnly && editor && <SectionBubbleMenu editor={editor} />}
      {!readOnly && editor && (
        // Notion-style block handle: ⠿ drags the hovered block, + inserts an
        // empty paragraph after it. nested={false} keeps it to top-level blocks
        // and avoids the yjs/collaboration peer deps.
        <DragHandle editor={editor} nested={false}>
          <div className="bid-drag-handle-inner" data-testid="bid-drag-handle-inner">
            <button
              type="button"
              title={t('editor.block_add')}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertContentAt(editor.state.selection.to, { type: 'paragraph' })
                  .run()
              }
            >
              +
            </button>
            <span aria-hidden>⠿</span>
          </div>
        </DragHandle>
      )}
      {!readOnly && editor && (
        <div className="mb-2 flex gap-2" data-testid="bid-editor-toolbar">
          <button
            type="button"
            data-testid="bid-insert-table-button"
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
            className="rounded-md px-2 py-1 text-[11px]"
            style={{ border: '1px solid var(--bid-border-2)', color: 'var(--bid-sub)' }}
          >
            {t('editor.insert_table')}
          </button>
          <button
            type="button"
            data-testid="bid-insert-pagebreak-button"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            className="rounded-md px-2 py-1 text-[11px]"
            style={{ border: '1px solid var(--bid-border-2)', color: 'var(--bid-sub)' }}
          >
            {t('editor.insert_pagebreak')}
          </button>
        </div>
      )}
      {autosave.state !== 'idle' && (
        <span
          data-testid="bid-section-save-state"
          className="text-[11px]"
          style={{ color: 'var(--bid-muted-2)' }}
        >
          {t(`editor.save_${autosave.state}`)}
        </span>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
