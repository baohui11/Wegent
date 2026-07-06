// SPDX-License-Identifier: Apache-2.0

interface Range {
  startLine: number
  endLine: number
}

/**
 * Split markdown into top-level blocks (1-indexed inclusive line ranges) by
 * scanning for blank-line separators.
 *
 * A top-level block is a maximal run of consecutive non-blank lines. This
 * matches how remark-parse groups paragraphs and list items for the common
 * bid cases (paragraphs, headings, bullet/ordered lists, fenced code,
 * blockquotes, GFM tables — all kept together by their surrounding blank
 * lines). Used to map a ProseMirror top-level node to the on-disk markdown
 * line range it occupies, so redraft-range can target exactly that block.
 *
 * (A dependency-free scan is used instead of unified/remark-parse because those
 * packages are ESM-only and resist Jest transformation under next/jest; the
 * scan is deterministic and covers the block shapes the bid editor emits.)
 */
export function blockLineRange(markdown: string, blockIndex: number): Range {
  const lines = markdown.split('\n')
  const blocks: Range[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    const start = i + 1 // 1-indexed
    while (i < lines.length && lines[i].trim() !== '') i++
    blocks.push({ startLine: start, endLine: i }) // i now points past last non-blank
  }
  if (blocks.length === 0) return { startLine: 1, endLine: lines.length }
  const b = blocks[Math.min(Math.max(blockIndex, 0), blocks.length - 1)]
  return { startLine: b.startLine, endLine: b.endLine }
}

/**
 * Index of the top-level block holding the current selection.
 *
 * Section-local mode (preferred, post bidSection refactor): pass the active
 * `sectionId`. The cursor's ancestor bidSection is found by walking up
 * `$from.node(depth)` until a bidSection whose `attrs.sectionId === sectionId`
 * is reached, then `$from.index(thatDepth)` is its position among that
 * section's children. Line numbers from `blockLineRange` are then relative to
 * THAT section's body markdown (title-less, per spike-notes §6), which matches
 * the bytes the backend stores — so redraft-range stays correctly addressed.
 *
 * Legacy/global mode (no sectionId): `$from.index(0)` — the position among the
 * document's direct children. Kept for callers not yet on the bidSection tree.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function topBlockIndexOf(editor: any, sectionId?: string): number {
  if (!editor) return 0
  const { $from } = editor.state.selection
  if (!sectionId) return $from.index(0)
  // Walk ancestors from the cursor upward to find the owning bidSection. The
  // bidSection sits one level above the cursor's textblock; its depth is at
  // most $from.depth.
  for (let depth = $from.depth; depth > 0; depth--) {
    const ancestor = $from.node(depth)
    if (
      ancestor &&
      ancestor.type &&
      ancestor.type.name === 'bidSection' &&
      String(ancestor.attrs?.sectionId) === sectionId
    ) {
      // index(depth) is the cursor block's index among the bidSection's
      // children — the section-local block number redraft-range needs.
      return $from.index(depth)
    }
  }
  // Cursor not inside the requested section: conservative 0 (the caller scopes
  // the request to the active section, so this is a defensive guard).
  return 0
}
