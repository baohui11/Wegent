// SPDX-License-Identifier: Apache-2.0
import { blockLineRange } from '@/features/bid/canvas/blockRange'

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
