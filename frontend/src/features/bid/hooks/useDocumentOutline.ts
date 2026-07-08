// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { deriveOutline, type OutlineEntry } from '../canvas/documentOutline'

// Live document outline for the left panel (PR-A ①②). Recomputes the entries
// whenever the document changes, tracks the active entry by CARET position (the
// Google Docs / VS Code editor model — correct now that the editor is always
// editable), and scrolls to an entry on click.
//
// `sectionNames` should be memoized by the caller: it is an effect dependency,
// so a fresh object every render would needlessly re-subscribe.
export function useDocumentOutline(editor: Editor | null, sectionNames: Record<string, string>) {
  const [entries, setEntries] = useState<OutlineEntry[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) return
    const recompute = () => {
      // Guard the mocked-editor path (Jest maps tiptap to a stub whose doc has
      // no real forEach → 0 entries; real behaviour is covered by Playwright).
      const doc = editor.state?.doc as { forEach?: unknown } | undefined
      const next =
        doc && typeof doc.forEach === 'function'
          ? deriveOutline(editor.state.doc, sectionNames)
          : []
      setEntries(next)
      // Active = the last entry whose position does not pass the caret.
      const caret = editor.state.selection?.$from?.pos ?? 0
      let active: OutlineEntry | null = null
      for (const e of next) {
        if (e.pos <= caret) active = e
        else break
      }
      setActiveKey(active?.key ?? next[0]?.key ?? null)
    }
    recompute()
    editor.on('update', recompute)
    editor.on('selectionUpdate', recompute)
    return () => {
      editor.off('update', recompute)
      editor.off('selectionUpdate', recompute)
    }
  }, [editor, sectionNames])

  const scrollTo = useCallback(
    (entry: OutlineEntry) => {
      // Sections have a stable DOM anchor (BidSectionNodeView data-bid-section);
      // in-body headings resolve their DOM via the ProseMirror position.
      if (entry.kind === 'section') {
        document
          .querySelector(`[data-bid-section="${entry.sectionId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      const dom = editor?.view?.domAtPos(entry.pos)?.node as globalThis.Node | undefined
      const el = dom?.nodeType === 1 ? (dom as HTMLElement) : (dom?.parentElement ?? null)
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    },
    [editor]
  )

  return { entries, activeKey, scrollTo }
}
