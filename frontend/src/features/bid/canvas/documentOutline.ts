// SPDX-License-Identifier: Apache-2.0
import type { Node as PMNode } from '@tiptap/pm/model'

// One entry in the live, document-derived table of contents (PR-A ①②). Chapters
// are the top-level bidSection nodes; headings are the H2/H3 inside a section's
// body. Deriving live from the doc (never a separate stored structure) is what
// keeps the left outline in sync as the user edits (Notion/Google Docs model).
export interface OutlineEntry {
  key: string
  kind: 'section' | 'heading'
  sectionId: string
  level: number // section = 1; heading = its own level (2/3)
  text: string
  pos: number // absolute ProseMirror position, for domAtPos-based scrolling
}

// Walk the document: each top-level bidSection becomes a chapter entry (its
// display name comes from `sectionNames`, since the NodeView renders the title,
// not the body), and each heading inside it becomes a sub-entry using its own
// text. `pos` is the absolute position so a heading can be scrolled to via
// editor.view.domAtPos(pos).
export function deriveOutline(
  doc: PMNode,
  sectionNames: Record<string, string> = {}
): OutlineEntry[] {
  const out: OutlineEntry[] = []
  doc.forEach((section, offset) => {
    if (section.type?.name !== 'bidSection') return
    const sectionId = String(section.attrs?.sectionId ?? '')
    out.push({
      key: sectionId,
      kind: 'section',
      sectionId,
      level: 1,
      text: sectionNames[sectionId] ?? sectionId,
      pos: offset,
    })
    // First child sits one position inside the section node; accumulate each
    // child's size to get the next child's absolute position.
    let inner = offset + 1
    section.forEach(child => {
      if (child.type?.name === 'heading') {
        out.push({
          key: `${sectionId}#${inner}`,
          kind: 'heading',
          sectionId,
          level: Number(child.attrs?.level ?? 2),
          text: child.textContent ?? '',
          pos: inner,
        })
      }
      inner += child.nodeSize
    })
  })
  return out
}
