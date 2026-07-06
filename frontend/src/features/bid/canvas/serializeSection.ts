// SPDX-License-Identifier: Apache-2.0

import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

// The tiptap-markdown storage exposes both `getMarkdown()` (whole doc) and a
// `serializer` whose `serialize(node)` renders any node's subtree (spike-notes
// §1 path (a)). Declare the minimal surface we consume.
interface MarkdownStorage {
  getMarkdown(): string
  serializer: { serialize(node: ProseMirrorNode): string }
}

// Serialize ONLY the given bidSection node's body to markdown — no wrapper
// syntax, no section title. Path (a) from spike-notes: the live
// MarkdownSerializer.renderContent(node) renders exactly that node's children,
// and reuses the live editor's serializer so the rules are identical to
// getMarkdown(). The bidSection node's markdown.serialize spec already drops
// the wrapper (Task 2), so passing the section node here yields body-only md.
export function serializeSection(editor: Editor, node: ProseMirrorNode): string {
  const serializer = (editor.storage as { markdown?: MarkdownStorage }).markdown?.serializer
  return serializer?.serialize(node) ?? ''
}

// On load, drop a leading `#`-heading line that merely repeats the section
// name (plus its trailing blank line). The heading must live in exactly one
// place — the section NodeView, rendered from the outline name — so the body
// markdown we hand to the editor, serialize on save, and redraft-range against
// never carries the title (spike-notes §6). Only a leading heading at the very
// start of the markdown counts; a body line starting with `#` mid-text is left
// alone.
export function markdownToSectionContent(md: string, sectionName: string): string {
  const lines = md.split('\n')
  const first = lines[0] ?? ''
  const heading = first.match(/^\s*#{1,6}\s+(.+?)\s*$/)
  if (!heading) return md
  if (heading[1].trim() !== sectionName.trim()) return md
  // Drop the heading line; also swallow exactly one immediately-following
  // blank line so the body doesn't start with an empty paragraph.
  const rest = lines.slice(1)
  if (rest.length > 0 && rest[0].trim() === '') rest.shift()
  return rest.join('\n')
}
