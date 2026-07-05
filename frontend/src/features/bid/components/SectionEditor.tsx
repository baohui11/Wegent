// SPDX-License-Identifier: Apache-2.0

'use client'

import { Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import { useEffect } from 'react'

interface SectionEditorProps {
  content: string
  readOnly: boolean
  onChange: (markdown: string) => void
  /** Receives the Tiptap Editor instance once it is mounted (for block-regen). */
  onEditorReady?: (editor: unknown) => void
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

export function SectionEditor({ content, readOnly, onChange, onEditorReady }: SectionEditorProps) {
  const editor = useEditor({
    editable: !readOnly,
    content,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    onUpdate: ({ editor }) => onChange(markdownOf(editor)),
    // Avoid SSR hydration mismatch — render the editor only on the client.
    immediatelyRender: false,
  })

  // Re-seed when a redraft replaces the content or the focused section changes.
  useEffect(() => {
    if (!editor) return
    if (content !== markdownOf(editor)) editor.commands.setContent(content, false)
  }, [content, editor])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [readOnly, editor])

  // Hand the editor instance to the parent so it can compute the current
  // top-level block for paragraph-level regeneration.
  useEffect(() => {
    if (editor) onEditorReady?.(editor)
  }, [editor, onEditorReady])

  return (
    <div className="bid-prose">
      <EditorContent editor={editor} />
    </div>
  )
}
