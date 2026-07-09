// SPDX-License-Identifier: Apache-2.0
import {
  clampHeadingLevel,
  nextSiblingHeadingEnd,
  siblingLeafBounds,
} from '@/features/bid/components/BidDocumentEditor'

describe('nextSiblingHeadingEnd', () => {
  it('stops at the next heading of same-or-higher level', () => {
    // levels: [2,3,3,2] ; deleting the H2 at idx 0 spans up to the next H2 (idx 3)
    expect(nextSiblingHeadingEnd([2, 3, 3, 2], 0)).toBe(3)
  })
  it('a same-level heading terminates the range (sibling boundary)', () => {
    // Per spec §5: a leaf-delete range runs to the next heading whose level is
    // <= the target's. Deleting the H3 at idx 1 therefore stops at the H3 at
    // idx 2 (same level = sibling), not the H2 at idx 3.
    expect(nextSiblingHeadingEnd([2, 3, 3, 2], 1)).toBe(2)
  })
  it('runs to the end when no later sibling/ancestor heading', () => {
    expect(nextSiblingHeadingEnd([2, 3, 3], 0)).toBe(3) // == length
  })
})

describe('clampHeadingLevel', () => {
  it('promotes/demotes within [2,5]', () => {
    expect(clampHeadingLevel(3, -1)).toBe(2)
    expect(clampHeadingLevel(3, +1)).toBe(4)
  })
  it('clamps at the H2 top and H5 bottom', () => {
    expect(clampHeadingLevel(2, -1)).toBe(2) // never H1 (chapter title)
    expect(clampHeadingLevel(5, +1)).toBe(5)
  })
})

describe('siblingLeafBounds', () => {
  it('bounds prev/current/next sibling leaf groups', () => {
    // levels [2,2,2]: middle leaf idx1 -> prev=0, curEnd=2, nextEnd=3
    expect(siblingLeafBounds([2, 2, 2], 1)).toEqual({ prevStart: 0, curEnd: 2, nextEnd: 3 })
  })
  it('nested content does not count as a sibling boundary', () => {
    // levels [2,3,2]: idx0 (H2 with a nested H3) -> prev=-1, curEnd=2 (next H2), nextEnd=3
    expect(siblingLeafBounds([2, 3, 2], 0)).toEqual({ prevStart: -1, curEnd: 2, nextEnd: 3 })
  })
  it('no previous sibling -> prevStart -1', () => {
    expect(siblingLeafBounds([2, 2], 0)).toEqual({ prevStart: -1, curEnd: 1, nextEnd: 2 })
  })
})
