// SPDX-License-Identifier: Apache-2.0
import { blockLineRange, topBlockIndexOf } from '@/features/bid/canvas/blockRange'

test('maps the second top-level block to its line range', () => {
  const md = '第一段。\n\n第二段。\n\n第三段。'
  // blocks: [para@1, para@3, para@5]
  expect(blockLineRange(md, 1)).toEqual({ startLine: 3, endLine: 3 })
})

test('maps a multi-line list block to its full range', () => {
  const md = '开头。\n\n- a\n- b\n- c'
  expect(blockLineRange(md, 1)).toEqual({ startLine: 3, endLine: 5 })
})

test('clamps out-of-range index to the whole doc', () => {
  const md = '只有一段。'
  const r = blockLineRange(md, 99)
  expect(r.startLine).toBe(1)
})

// Build a fake editor whose selection $from sits at a known depth, with the
// ancestor bidSection node at `sectionDepth` carrying attrs.sectionId. The
// section-local index is `selection.$from.index(sectionDepth)` — the position
// of the cursor's block among the bidSection's children.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mkEditor = (sectionDepth: number, indexAtDepth: number, sectionId: string): any => {
  // $from.node(depth) returns the ancestor node at `depth`; we build a chain
  // where the bidSection ancestor carries attrs.sectionId.
  const bidSectionNode = {
    type: { name: 'bidSection' },
    attrs: { sectionId },
  }
  // A stack of ancestors from doc(0) down to the cursor's textblock. Each
  // .node(d) returns the ancestor at that depth; .index(d) returns the cursor's
  // child-index within the ancestor at depth d.
  const ancestors = [
    { type: { name: 'doc' } }, // depth 0
    bidSectionNode, // depth 1
    { type: { name: 'paragraph' } }, // depth 2 (textblock)
  ]
  return {
    state: {
      selection: {
        $from: {
          depth: sectionDepth + 1, // cursor sits one below the bidSection
          node: (d: number) => ancestors[d],
          index: (d: number) => (d === sectionDepth ? indexAtDepth : 0),
        },
      },
    },
  }
}

describe('topBlockIndexOf (section-local)', () => {
  test('returns the cursor block index LOCAL to its bidSection (not global)', () => {
    // Two sections each with 3 top-level blocks; cursor in section B's 2nd
    // block. Global index would be 4 (3 in A + 1 in B); section-local must be 1.
    const editor = mkEditor(1, 1, 'b')
    expect(topBlockIndexOf(editor, 'b')).toBe(1)
  })

  test('cursor in section A block 0 returns 0', () => {
    expect(topBlockIndexOf(mkEditor(1, 0, 'a'), 'a')).toBe(0)
  })

  test('falls back to global doc index when sectionId is absent (legacy path)', () => {
    // No sectionId -> behave as the old global $from.index(0) path (used before
    // the bidSection refactor). We don't ship a legacy caller, but the branch
    // keeps the function safe when called without a section context.
    const editor = {
      state: { selection: { $from: { index: (d: number) => (d === 0 ? 7 : 0) } } },
    }
    expect(topBlockIndexOf(editor)).toBe(7)
  })

  test('returns 0 when the cursor is not inside the target section', () => {
    // Cursor is in section A but we asked for B: the ancestor chain does not
    // match the requested sectionId, so the cursor is "not in B" -> index 0
    // (caller scopes the request to the active section, so this is a guard).
    const editor = mkEditor(1, 1, 'a')
    expect(topBlockIndexOf(editor, 'b')).toBe(0)
  })
})
