// SPDX-License-Identifier: Apache-2.0
import { applyTableCommand, TABLE_COMMANDS } from '@/features/bid/components/TableHoverControls'
import { __mockEditor } from '@/__mocks__/@tiptap__react'

beforeEach(() => {
  __mockEditor.__chainCalls = []
})

test('TABLE_COMMANDS cover add/delete row+column, header toggle and delete table', () => {
  expect(TABLE_COMMANDS.map(c => c.cmd)).toEqual([
    'addColumnBefore',
    'addColumnAfter',
    'deleteColumn',
    'addRowBefore',
    'addRowAfter',
    'deleteRow',
    'toggleHeaderRow',
    'deleteTable',
  ])
})

test('applyTableCommand moves the selection into the hovered cell, then runs it', () => {
  applyTableCommand(__mockEditor, 12, 'addColumnAfter')
  expect(__mockEditor.__chainCalls).toContain('setTextSelection')
  expect(__mockEditor.__chainCalls).toContain('addColumnAfter')
})

test('applyTableCommand skips the selection move when there is no cell position', () => {
  applyTableCommand(__mockEditor, -1, 'deleteTable')
  expect(__mockEditor.__chainCalls).not.toContain('setTextSelection')
  expect(__mockEditor.__chainCalls).toContain('deleteTable')
})
