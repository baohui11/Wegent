// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  BlockInsertMenu,
  BLOCK_INSERT_ITEMS,
  type BlockTarget,
  type OpenMenu,
} from '@/features/bid/components/BlockInsertMenu'
import { __mockEditor } from '@/__mocks__/@tiptap__react'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// A hovered paragraph at pos 3, size 5 → insert-below point is pos 8.
const TARGET: BlockTarget = {
  node: {
    type: { name: 'paragraph' },
    nodeSize: 5,
    toJSON: () => ({ type: 'paragraph' }),
  } as never,
  pos: 3,
}

// The menus are controlled by the parent; wrap so clicks drive open state.
function Harness({ target = TARGET as BlockTarget | null }: { target?: BlockTarget | null }) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  return (
    <BlockInsertMenu
      editor={__mockEditor}
      target={target}
      openMenu={openMenu}
      onOpenMenuChange={setOpenMenu}
    />
  )
}

beforeEach(() => {
  __mockEditor.__chainCalls = []
})

test('+ opens the insert menu; a block INSERTS after the target (not a toggle)', () => {
  render(<Harness />)
  expect(screen.queryByTestId('bid-block-insert-menu')).not.toBeInTheDocument()
  fireEvent.click(screen.getByTestId('bid-block-insert-trigger'))
  expect(screen.getByTestId('bid-block-insert-menu')).toBeInTheDocument()

  fireEvent.click(screen.getByTestId('bid-block-insert-paragraph'))
  expect(__mockEditor.__chainCalls).toContain('insertContentAt')
  expect(__mockEditor.__chainCalls).not.toContain('setParagraph')
  expect(screen.queryByTestId('bid-block-insert-menu')).not.toBeInTheDocument()
})

test('insert menu offers the expected types; heading1 and task-list excluded', () => {
  render(<Harness />)
  fireEvent.click(screen.getByTestId('bid-block-insert-trigger'))
  for (const item of BLOCK_INSERT_ITEMS) {
    expect(screen.getByTestId(`bid-block-insert-${item.key}`)).toBeInTheDocument()
  }
  expect(screen.queryByTestId('bid-block-insert-heading1')).not.toBeInTheDocument()
  expect(screen.queryByTestId('bid-block-insert-task_list')).not.toBeInTheDocument()
})

test('table uses the table helper; divider inserts a horizontalRule block', () => {
  render(<Harness />)
  fireEvent.click(screen.getByTestId('bid-block-insert-trigger'))
  fireEvent.click(screen.getByTestId('bid-block-insert-table'))
  expect(__mockEditor.__chainCalls).toContain('insertTable')

  __mockEditor.__chainCalls = []
  fireEvent.click(screen.getByTestId('bid-block-insert-trigger'))
  fireEvent.click(screen.getByTestId('bid-block-insert-divider'))
  expect(__mockEditor.__chainCalls).toContain('insertContentAt')
  expect(__mockEditor.__chainCalls).not.toContain('setHorizontalRule')
})

test('⠿ opens block actions: insert above/below, duplicate, delete', () => {
  render(<Harness />)
  fireEvent.click(screen.getByTestId('bid-block-actions-trigger'))
  expect(screen.getByTestId('bid-block-actions-menu')).toBeInTheDocument()
  for (const k of ['insert_above', 'insert_below', 'duplicate', 'delete']) {
    expect(screen.getByTestId(`bid-block-action-${k}`)).toBeInTheDocument()
  }
})

test('duplicate inserts a copy of the block; delete removes its range', () => {
  render(<Harness />)
  fireEvent.click(screen.getByTestId('bid-block-actions-trigger'))
  fireEvent.click(screen.getByTestId('bid-block-action-duplicate'))
  expect(__mockEditor.__chainCalls).toContain('insertContentAt')

  __mockEditor.__chainCalls = []
  fireEvent.click(screen.getByTestId('bid-block-actions-trigger'))
  fireEvent.click(screen.getByTestId('bid-block-action-delete'))
  expect(__mockEditor.__chainCalls).toContain('deleteRange')
})

test('does nothing when there is no hovered target', () => {
  render(<Harness target={null} />)
  fireEvent.click(screen.getByTestId('bid-block-actions-trigger'))
  fireEvent.click(screen.getByTestId('bid-block-action-delete'))
  expect(__mockEditor.__chainCalls).toEqual([])
})
