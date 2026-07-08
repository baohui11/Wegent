// SPDX-License-Identifier: Apache-2.0
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, EditorContent, useEditor } from '@tiptap/react'
import { generateJSON } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { useTranslation } from '@/hooks/useTranslation'
import { BlockInsertMenu, type OpenMenu } from './BlockInsertMenu'
import { TableHoverControls } from './TableHoverControls'
import { useDocumentAutosave } from '../hooks/useDocumentAutosave'
import { BidSection } from '../extensions/bidSection'
import { BidDocument } from '../extensions/bidDocument'
import { BidPlaceholder } from '../extensions/bidPlaceholder'
import { markdownToSectionContent, serializeSection } from '../canvas/serializeSection'
import { attrSignature, contentSignature } from '../canvas/docSync'
import { injectPlaceholders } from '../canvas/placeholders'
import { SectionBubbleMenu } from './SectionBubbleMenu'

export type BidSectionStatus = 'pending' | 'drafting' | 'done' | 'error' | 'needs_rework'

// The inline-text range of a heading node that starts at `pos` and has size
// `nodeSize` (i.e. excluding the node's open/close tokens). Pure so it can be
// unit-tested without a live editor.
export function headingTextRange(nodeSize: number, pos: number): { from: number; to: number } {
  return { from: pos + 1, to: pos + nodeSize - 1 }
}

// Public API surface the editor exposes to its parent (GenerateRefineScreen):
// the live editor instance (for section-local block targeting / redraft-range)
// and a flush that persists the active section and resolves to its post-save
// CAS version.
export interface BidDocumentEditorApi {
  editor: Editor | null
  flushSection: (sectionId: string) => Promise<string>
  /** Replace the heading at absolute pos `pos` with `text`, then flush its
   * section (returns the new version). Used by the TOC leaf inline-rename. */
  renameHeadingAt: (pos: number, text: string, sectionId: string) => Promise<string>
}

interface SectionSpec {
  id: string
  content: string // raw markdown (with its title line, as the backend stores it)
  version: string
  status: BidSectionStatus
  accepted: boolean
  title?: string // chapter title, from the outline (rendered by the NodeView)
}

interface BidDocumentEditorProps {
  projectId: number
  sections: SectionSpec[]
  // sectionId -> outline title (rendered once by the NodeView as the heading).
  sectionNames: Record<string, string>
  onSaved: (sectionId: string, version: string, markdown?: string) => void
  onActiveSectionChange?: (sectionId: string | null) => void
  /** Block-scoped AI regen (🅑) — wired to the bubble menu's ↻, carrying the
   * instruction gathered from its popover (③). */
  onRegenerateBlock?: (instruction?: string) => void
  /** Rename a section's chapter title — persisted to the outline (single source). */
  onRenameSection?: (sectionId: string, title: string) => void
  /** Unfilled placeholder count (🅓), reported on load and on every edit. */
  onPlaceholderCountChange?: (count: number) => void
  /** Mounted and ready — parent gets the editor + per-section flush. */
  onReady?: (api: BidDocumentEditorApi) => void
}

// Block-level schema used ONLY to parse a section BODY's HTML into block JSON.
// It must NOT include BidDocument/BidSection: BidDocument's top node is
// `bidSection+`, which would reject a body's plain paragraphs/headings; a
// default block-level `doc` lets them parse. Node types here (paragraph,
// heading, lists, blockquote, code, image, table) all exist in the live
// editor's schema, so the resulting JSON loads cleanly inside a bidSection.
const BODY_EXTENSIONS = [
  // Heading levels 2–5 (level 1 is the chapter title, rendered by the NodeView
  // from the outline). MUST match the live editor's StarterKit config below, or
  // generateJSON's heading JSON won't match the live schema on initial load.
  StarterKit.configure({ heading: { levels: [2, 3, 4, 5] }, link: { openOnClick: false } }),
  Image,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

// Convert a section body's HTML (what tiptap-markdown's parser.parse returns)
// into an array of block JSON for a bidSection's children. Empty HTML yields a
// single empty paragraph (a bidSection's content is `block+`, never empty).
// Exported so the real-tiptap conversion is unit-testable (the editor + its
// markdown parser are mocked in Jest, which is exactly what hid the original
// "parse() returns a string" bug).
export function htmlToBlockContent(html: string): unknown[] {
  if (!html) return [{ type: 'paragraph' }]
  try {
    const body = generateJSON(html, BODY_EXTENSIONS) as { content?: unknown[] }
    return body.content && body.content.length > 0 ? body.content : [{ type: 'paragraph' }]
  } catch {
    // generateJSON needs real block extensions to build a schema; if that fails
    // (e.g. tiptap extensions stubbed under Jest, or malformed HTML), degrade to
    // an empty paragraph instead of crashing the editor mount. The real-browser
    // conversion is covered by the Playwright smoke (bid-roundtrip-smoke.spec.ts).
    return [{ type: 'paragraph' }]
  }
}

// Assemble the single-document JSON: one bidSection node per section, each
// carrying its addressing attrs and a body parsed from the title-less section
// markdown. tiptap-markdown's `parser.parse()` returns an HTML STRING (not a PM
// node), so we convert that HTML to block JSON via generateJSON and take its
// content as the section's children.
function buildDocJson(
  editor: Editor,
  sections: SectionSpec[],
  sectionNames: Record<string, string>,
  // sectionId -> block JSON to use verbatim instead of parsing `content`. Set
  // for sections that carry an unsaved user edit so an external re-sync keeps
  // the edited body (its live block JSON) rather than reverting to the prop.
  bodyOverrides: Record<string, unknown[]> = {}
): unknown {
  const parser = (
    editor.storage as {
      markdown?: { parser: { parse: (md: string) => string } }
    }
  ).markdown?.parser
  const sectionNodes = sections.map(sec => {
    const override = bodyOverrides[sec.id]
    let childContent: unknown[]
    if (override) {
      childContent = override.length > 0 ? override : [{ type: 'paragraph' }]
    } else {
      const bodyMd = markdownToSectionContent(sec.content, sectionNames[sec.id] ?? sec.id)
      // md -> HTML (tiptap-markdown parser) -> block JSON (generateJSON), then
      // rewrite unfilled markers into atomic bidPlaceholder chips (🅓).
      const html = parser ? parser.parse(bodyMd) : ''
      childContent = injectPlaceholders(htmlToBlockContent(html))
    }
    return {
      type: 'bidSection',
      attrs: {
        sectionId: sec.id,
        version: sec.version,
        status: sec.status,
        accepted: sec.accepted,
        title: sec.title ?? '',
      },
      content: childContent as unknown[],
    }
  })
  return { type: 'doc', content: sectionNodes }
}

interface CurrentSection {
  sid: string
  node: ProseMirrorNode
  // Live body differs from the last-seeded/saved snapshot → unsaved user edit.
  dirty: boolean
}

// Walk the editor's current top-level bidSection nodes and flag which ones hold
// an unsaved edit (body != snapshot). A section never seeded (snapshot
// undefined) is treated as clean — it is about to be seeded from props.
function collectCurrentSections(
  editor: Editor,
  getSnapshot: (sid: string) => string | undefined
): CurrentSection[] {
  const out: CurrentSection[] = []
  editor.state.doc.forEach(n => {
    const node = n as ProseMirrorNode
    if (node.type?.name !== 'bidSection') return
    const sid = String(node.attrs?.sectionId ?? '')
    const snap = getSnapshot(sid)
    out.push({ sid, node, dirty: snap !== undefined && serializeSection(editor, node) !== snap })
  })
  return out
}

interface CaretInfo {
  sid: string
  offset: number
}

// Record the caret as (owning section id + offset within that section) so it can
// be restored after a full-document rebuild. Returns null when there is no real
// selection API (e.g. the editor is mocked under Jest) — restoration is a
// best-effort UX nicety, never a correctness requirement.
function captureCaret(editor: Editor): CaretInfo | null {
  try {
    const $from = editor.state.selection?.$from
    if (!$from || typeof $from.node !== 'function' || typeof $from.start !== 'function') return null
    for (let d = $from.depth; d > 0; d--) {
      const anc = $from.node(d)
      if (anc?.type?.name === 'bidSection') {
        return { sid: String(anc.attrs?.sectionId ?? ''), offset: $from.pos - $from.start(d) }
      }
    }
  } catch {
    // No real selection to capture.
  }
  return null
}

// Put the caret back into the same section at (clamped) the same offset.
function restoreCaret(editor: Editor, caret: CaretInfo | null): void {
  if (!caret) return
  try {
    // Collect into an array (not a mutable `let x = null`) so TS keeps the
    // element type instead of narrowing the closure variable to `never`.
    const found: Array<{ pos: number; node: ProseMirrorNode }> = []
    editor.state.doc.forEach((n, pos) => {
      if (found.length) return
      const node = n as ProseMirrorNode
      if (node.type?.name === 'bidSection' && String(node.attrs?.sectionId ?? '') === caret.sid) {
        found.push({ pos, node })
      }
    })
    const target = found[0]
    if (!target) return
    const clamped = Math.min(target.pos + 1 + caret.offset, target.pos + target.node.nodeSize - 1)
    editor.chain().setTextSelection(clamped).run()
  } catch {
    // Positions can be invalid if the section shrank; ignore.
  }
}

// Count unfilled placeholder chips across the whole document (🅓). Guards the
// mocked-editor path (no real ProseMirror doc under Jest → 0).
function countPlaceholders(editor: Editor): number {
  const doc = editor.state?.doc as { descendants?: (fn: (n: ProseMirrorNode) => void) => void }
  if (!doc || typeof doc.descendants !== 'function') return 0
  let n = 0
  doc.descendants(node => {
    if (node.type?.name === 'bidPlaceholder') n++
  })
  return n
}

export function BidDocumentEditor({
  projectId,
  sections,
  sectionNames,
  onSaved,
  onActiveSectionChange,
  onRegenerateBlock,
  onRenameSection,
  onPlaceholderCountChange,
  onReady,
}: BidDocumentEditorProps) {
  const { t } = useTranslation('bidWorkbench')
  // Latest rename handler behind a stable ref — the editor's extension options
  // are frozen at creation, so the NodeView reaches the current callback here.
  const onRenameRef = useRef<((sectionId: string, title: string) => void) | null>(null)
  onRenameRef.current = onRenameSection ?? null
  const [activeSection, setActiveSection] = useState<string | null>(null)
  // Last section id reported to the parent, so selection-driven reporting can
  // dedupe without depending on the (closure-stale) `activeSection` state.
  const activeSectionRef = useRef<string | null>(null)
  // Report the caret's owning bidSection to the parent. MUST run on selection
  // change (not only doc change): the right panel + paragraph regen address the
  // section the caret is IN, and merely clicking / selecting produces no doc
  // update. Reads live editor state, so a stale closure is harmless.
  const reportActiveSection = useCallback(
    (ed: Editor) => {
      const $from = ed.state.selection?.$from
      if (!$from || typeof $from.node !== 'function') return
      for (let depth = $from.depth; depth > 0; depth--) {
        const ancestor = $from.node(depth)
        if (ancestor?.type?.name === 'bidSection') {
          const sid = String(ancestor.attrs?.sectionId ?? '')
          if (sid !== activeSectionRef.current) {
            activeSectionRef.current = sid
            setActiveSection(sid)
            onActiveSectionChange?.(sid)
          }
          return
        }
      }
    },
    [onActiveSectionChange]
  )
  // The block the drag handle currently sits beside (a child of a bidSection —
  // NOT the whole section — because we enable nested targeting below). The `+`
  // insert menu inserts a new block right after this one. Kept across pointer
  // leave (node === null) so an open menu still knows its target.
  const [hovered, setHovered] = useState<{ node: ProseMirrorNode; pos: number } | null>(null)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  // Two independent re-sync signals (see docSync.ts): contentKey drives the
  // rebuild-and-reseed path; attrKey drives targeted attribute updates. Keeping
  // version/accepted OUT of contentKey is what stops an autosave (which only
  // bumps a section's CAS version) from rebuilding the document and reverting
  // the user's just-saved edit.
  const contentKey = useMemo(() => contentSignature(sections), [sections])
  const attrKey = useMemo(() => attrSignature(sections), [sections])

  const editor = useEditor({
    editable: true,
    extensions: [
      StarterKit.configure({
        document: false,
        heading: { levels: [2, 3, 4, 5] },
        link: { openOnClick: false },
      }),
      BidDocument,
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true }),
      BidSection.configure({ sectionNames, onRenameSectionRef: onRenameRef }),
      BidPlaceholder,
    ],
    content: { type: 'doc', content: [] },
    // Track the active section from the cursor's owning bidSection so the right
    // panel / paragraph regen address the section the caret is in. MUST fire on
    // selection change too — clicking / arrowing into another section produces
    // no doc update, and addressing off a stale section is the core rewrite bug.
    onUpdate: ({ editor }) => reportActiveSection(editor),
    onSelectionUpdate: ({ editor }) => reportActiveSection(editor),
    immediatelyRender: false,
  })

  const autosave = useDocumentAutosave({ projectId, editor, onSaved })

  // Rebuild the document body whenever the section set / order / a section body
  // changes externally (initial load, redraft, regen). NOT on version/accepted
  // changes — those are attribute-only (see the attr effect below).
  //
  // The dispatch is deferred to a microtask because bidSection renders via
  // ReactNodeViewRenderer: replacing the doc mounts React node-view portals
  // that Tiptap flushes with flushSync, and doing that synchronously inside a
  // React lifecycle collides with React 19's render cycle ("flushSync ... cannot
  // flush when React is already rendering"). queueMicrotask runs it after React
  // finishes the current commit. (Tiptap performance guide.)
  //
  // Sections the user has edited but not yet saved are "dirty": their live body
  // is preserved (fed back as an override) so an external re-sync never drops an
  // in-progress edit; on conflict the user's edit wins.
  useEffect(() => {
    if (!editor || sections.length === 0) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return
      const current = collectCurrentSections(editor, autosave.getSnapshot)
      const dirty = new Set(current.filter(c => c.dirty).map(c => c.sid))
      const overrides: Record<string, unknown[]> = {}
      for (const c of current) {
        if (c.dirty) overrides[c.sid] = (c.node.toJSON().content as unknown[]) ?? []
      }
      const caret = captureCaret(editor)
      const doc = buildDocJson(editor, sections, sectionNames, overrides)
      editor.commands.command(({ tr, state, dispatch }) => {
        const newDoc = state.schema.nodeFromJSON(doc as never)
        tr.replaceWith(0, tr.doc.content.size, newDoc.content)
        tr.setMeta('bidSeed', true)
        dispatch?.(tr)
        return true
      })
      restoreCaret(editor, caret)
      // Reseed the clean baseline for every section (re)built from props so the
      // freshly-loaded body is not seen as dirty. Dirty sections keep their old
      // snapshot so their pending autosave still fires with the preserved edit.
      for (const s of sections) {
        if (!dirty.has(s.id)) autosave.seedSection(s.id)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, contentKey])

  // Apply version / status / accepted changes as targeted attribute updates on
  // the matching bidSection nodes — no rebuild, no NodeView remount, no caret
  // loss. Deferred for the same flushSync reason as the rebuild effect.
  useEffect(() => {
    if (!editor || sections.length === 0) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return
      const want = new Map(
        sections.map(s => [
          s.id,
          { version: s.version, status: s.status, accepted: s.accepted, title: s.title ?? '' },
        ])
      )
      editor.commands.command(({ tr, state, dispatch }) => {
        let changed = false
        state.doc.forEach((n, pos) => {
          const node = n as ProseMirrorNode
          if (node.type?.name !== 'bidSection') return
          const w = want.get(String(node.attrs?.sectionId ?? ''))
          if (!w) return
          if (node.attrs.version !== w.version) {
            tr.setNodeAttribute(pos, 'version', w.version)
            changed = true
          }
          if (node.attrs.status !== w.status) {
            tr.setNodeAttribute(pos, 'status', w.status)
            changed = true
          }
          if (node.attrs.accepted !== w.accepted) {
            tr.setNodeAttribute(pos, 'accepted', w.accepted)
            changed = true
          }
          if (w.title && node.attrs.title !== w.title) {
            tr.setNodeAttribute(pos, 'title', w.title)
            changed = true
          }
        })
        if (!changed) return false
        tr.setMeta('bidSeed', true)
        dispatch?.(tr)
        return true
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, attrKey])

  // Report the unfilled-placeholder count (🅓) on load/rebuild and every edit,
  // so the parent can show the badge and gate the proceed action.
  useEffect(() => {
    if (!editor || !onPlaceholderCountChange) return
    const report = () => onPlaceholderCountChange(countPlaceholders(editor))
    report()
    editor.on('update', report)
    return () => {
      editor.off('update', report)
    }
    // contentKey re-runs the initial report after a rebuild seeds new chips.
  }, [editor, onPlaceholderCountChange, contentKey])

  // Replace the heading at absolute pos `pos` with `text`, then flush its
  // section (returns the new version). Used by the TOC leaf inline-rename.
  const renameHeadingAt = useCallback(
    async (pos: number, text: string, sectionId: string): Promise<string> => {
      const node = editor?.state.doc.nodeAt(pos)
      if (editor && node) {
        const { from, to } = headingTextRange(node.nodeSize, pos)
        editor
          .chain()
          .command(({ tr }) => {
            tr.insertText(text, from, to)
            return true
          })
          .run()
      }
      return autosave.flushSection(sectionId)
    },
    [editor, autosave]
  )

  // Hand the editor + flush to the parent for section-level operations.
  useEffect(() => {
    if (editor) {
      onReady?.({ editor, flushSection: autosave.flushSection, renameHeadingAt })
    }
  }, [editor, onReady, autosave.flushSection, renameHeadingAt])

  // The drag handle's hovered target changed. Remember the block (for the insert
  // menu) and collapse any open menu, since it belonged to the previous block.
  const handleNodeChange = useCallback(
    ({ node, pos }: { node: ProseMirrorNode | null; pos: number }) => {
      if (node) setHovered({ node, pos })
      setOpenMenu(null)
    },
    []
  )

  // Freeze the drag handle while either menu is open so moving the pointer
  // doesn't reposition/hide it out from under the user. The React DragHandle has
  // no `locked` prop; the underlying plugin consumes a `lockDragHandle` tr meta.
  // Deferred to a microtask: dispatching a transaction synchronously here flushes
  // the React NodeView portals (flushSync) during React's own render, which React
  // 19 rejects — the microtask runs it after the commit settles.
  useEffect(() => {
    const view = editor?.view
    if (!view) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return
      view.dispatch(view.state.tr.setMeta('lockDragHandle', openMenu !== null))
    })
    return () => {
      cancelled = true
    }
  }, [editor, openMenu])

  const flush = useCallback((sid: string) => autosave.flushSection(sid), [autosave])
  // Reference flush so it's part of the component's stable surface even when
  // onReady is absent (keeps the callback alive for future parent wiring).
  void flush

  // Save state of the section the caret currently sits in (document-level
  // autosave keys state per section). Shown next to the toolbar as live feedback.
  const activeSaveState = activeSection ? autosave.saveState[activeSection] : undefined

  return (
    <div className="bid-prose" data-testid="bid-document-editor">
      {editor && <SectionBubbleMenu editor={editor} onRegenerateBlock={onRegenerateBlock} />}
      {editor && (
        // Notion-style block handle: ⠿ drags the hovered block, + inserts a new
        // block right after it (subproject 🅐). nested targeting is REQUIRED here
        // because the doc's top-level nodes are bidSections — without it the
        // handle would target/insert against the whole section, not the block the
        // pointer is on. allowedContainers scopes it to blocks inside a section
        // (the section itself is excluded, so ⠿ never drags an entire chapter).
        <DragHandle
          editor={editor}
          // Keep the library's default `drag-handle` class AND add our own so a
          // stylesheet can nudge the handle into a left gutter — otherwise it
          // floats directly over a list item's marker (the ⠿/+ overlap the "1.").
          className="drag-handle bid-drag-handle"
          nested={{ allowedContainers: ['bidSection'] }}
          onNodeChange={handleNodeChange}
        >
          <BlockInsertMenu
            editor={editor}
            target={hovered}
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
          />
        </DragHandle>
      )}
      {editor && <TableHoverControls editor={editor} />}
      {editor && activeSaveState && activeSaveState !== 'idle' && (
        // Save state of the caret's section — live autosave feedback.
        <div className="mb-2 flex justify-end">
          <span
            data-testid="bid-section-save-state"
            className="text-[11px]"
            style={{ color: 'var(--bid-muted-2)' }}
          >
            {t(`editor.save_${activeSaveState}`)}
          </span>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
