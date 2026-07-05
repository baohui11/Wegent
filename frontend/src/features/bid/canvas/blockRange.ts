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
 * Index of the top-level ProseMirror node holding the current selection.
 * depth 1 is the top-level block under doc; index(0) is its position among
 * the doc's children — which corresponds 1:1 to the top-level markdown block
 * after tiptap-markdown serialization.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function topBlockIndexOf(editor: any): number {
  if (!editor) return 0
  const { $from } = editor.state.selection
  return $from.index(0)
}
