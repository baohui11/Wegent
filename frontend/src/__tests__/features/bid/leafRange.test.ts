// SPDX-License-Identifier: Apache-2.0
import { nextSiblingHeadingEnd } from '@/features/bid/components/BidDocumentEditor'

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
