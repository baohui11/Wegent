// SPDX-License-Identifier: Apache-2.0
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import { useDocumentAutosave } from '../hooks/useDocumentAutosave'
import { BidSection } from '../extensions/bidSection'
import { BidDocument } from '../extensions/bidDocument'
import { markdownToSectionContent } from '../canvas/serializeSection'
import { SectionBubbleMenu } from './SectionBubbleMenu'

export type BidSectionStatus = 'pending' | 'drafting' | 'done' | 'error' | 'needs_rework'

// Public API surface the editor exposes to its parent (GenerateRefineScreen):
// the live editor instance (for section-local block targeting / redraft-range)
// and a flush that persists the active section and resolves to its post-save
// CAS version.
export interface BidDocumentEditorApi {
  editor: Editor | null
  flushSection: (sectionId: string) => Promise<string>
}

interface SectionSpec {
  id: string
  content: string // raw markdown (with its title line, as the backend stores it)
  version: string
  status: BidSectionStatus
  accepted: boolean
}

interface BidDocumentEditorProps {
  projectId: number
  sections: SectionSpec[]
  // sectionId -> outline title (rendered once by the NodeView as the heading).
  sectionNames: Record<string, string>
  mode: 'read' | 'edit'
  onSaved: (sectionId: string, version: string) => void
  onActiveSectionChange?: (sectionId: string | null) => void
  /** Mounted and ready — parent gets the editor + per-section flush. */
  onReady?: (api: BidDocumentEditorApi) => void
}

// Assemble the single-document JSON: one bidSection node per section, each
// carrying its addressing attrs and a body parsed from the title-less section
// markdown. The body is parsed via the live editor's markdown parser so the
// exact same rules as getMarkdown() apply (round-trip fidelity, spike-notes §1).
function buildDocJson(
  editor: Editor,
  sections: SectionSpec[],
  sectionNames: Record<string, string>
): unknown {
  const parser = (
    editor.storage as {
      markdown?: { parser: { parse: (md: string) => { toJSON: () => unknown } } }
    }
  ).markdown?.parser
  const sectionNodes = sections.map(sec => {
    const bodyMd = markdownToSectionContent(sec.content, sectionNames[sec.id] ?? sec.id)
    // Parse the body markdown into a PM doc fragment; its content is the
    // section's child blocks.
    const parsed = parser ? parser.parse(bodyMd) : null
    const childContent =
      parsed && typeof (parsed as { toJSON?: () => unknown }).toJSON === 'function'
        ? ((parsed as { toJSON: () => { content?: unknown } }).toJSON().content ?? [])
        : [{ type: 'paragraph' }]
    return {
      type: 'bidSection',
      attrs: {
        sectionId: sec.id,
        version: sec.version,
        status: sec.status,
        accepted: sec.accepted,
      },
      content: childContent as unknown[],
    }
  })
  return { type: 'doc', content: sectionNodes }
}

export function BidDocumentEditor({
  projectId,
  sections,
  sectionNames,
  mode,
  onSaved,
  onActiveSectionChange,
  onReady,
}: BidDocumentEditorProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const sectionsKey = useMemo(
    () => sections.map(s => `${s.id}:${s.version}:${s.status}:${s.accepted}`).join('|'),
    [sections]
  )
  // First-population guard: seed snapshots once after the initial setContent so
  // the loaded content is not treated as a user edit (the mount-time-PUT guard).
  const seededRef = useRef(false)

  const editor = useEditor({
    editable: mode === 'edit',
    extensions: [
      StarterKit.configure({ document: false, link: { openOnClick: false } }),
      BidDocument,
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true }),
      BidSection.configure({ sectionNames }),
    ],
    content: { type: 'doc', content: [] },
    onUpdate: ({ editor }) => {
      // Track the active section from the cursor's owning bidSection so the
      // right panel / paragraph regen address the section being edited.
      const { $from } = editor.state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        const ancestor = $from.node(depth)
        if (ancestor?.type?.name === 'bidSection') {
          const sid = String(ancestor.attrs?.sectionId ?? '')
          if (sid !== activeSection) {
            setActiveSection(sid)
            onActiveSectionChange?.(sid)
          }
          break
        }
      }
    },
    immediatelyRender: false,
  })

  const autosave = useDocumentAutosave({ projectId, editor, onSaved })

  // Populate the document whenever the section set changes (initial load +
  // per-section redraft re-fetch). Stamped bidSeed so it never autosaves.
  useEffect(() => {
    if (!editor || sections.length === 0) return
    const doc = buildDocJson(editor, sections, sectionNames)
    editor.commands.command(({ tr, state, dispatch }) => {
      const newDoc = state.schema.nodeFromJSON(doc as never)
      tr.replaceWith(0, tr.doc.content.size, newDoc.content)
      tr.setMeta('bidSeed', true)
      dispatch?.(tr)
      return true
    })
    // Seed the autosave baseline after the population settles so the loaded
    // bytes are not "dirty" (prevents the mount-time PUT regression).
    if (!seededRef.current) {
      seededRef.current = true
      // Defer one tick so the transaction above has flushed.
      queueMicrotask(() => autosave.seedSnapshots())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sectionsKey])

  // Read/Edit mode flips the whole editor's editable flag.
  useEffect(() => {
    editor?.setEditable(mode === 'edit')
  }, [mode, editor])

  // Hand the editor + flush to the parent for section-level operations.
  useEffect(() => {
    if (editor) {
      onReady?.({ editor, flushSection: autosave.flushSection })
    }
  }, [editor, onReady, autosave.flushSection])

  const flush = useCallback((sid: string) => autosave.flushSection(sid), [autosave])
  // Reference flush so it's part of the component's stable surface even when
  // onReady is absent (keeps the callback alive for future parent wiring).
  void flush

  return (
    <div className="bid-prose" data-testid="bid-document-editor">
      {mode === 'edit' && editor && <SectionBubbleMenu editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}
