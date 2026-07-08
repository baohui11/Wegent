// SPDX-License-Identifier: Apache-2.0
import { headingTextRange } from '@/features/bid/components/BidDocumentEditor'

describe('headingTextRange', () => {
  it('excludes the heading node open/close tokens', () => {
    // A heading at pos=5 spanning 10 (its text lives at [6, 14)).
    expect(headingTextRange(10, 5)).toEqual({ from: 6, to: 14 })
  })
})
