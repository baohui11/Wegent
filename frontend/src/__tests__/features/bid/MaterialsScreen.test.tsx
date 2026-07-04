// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react'
import { MaterialsScreen } from '@/features/bid/components/MaterialsScreen'
import type { OutlineDoc } from '@/apis/bid'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const OUTLINE: OutlineDoc = {
  sections: [
    {
      id: 'c1',
      title: 'Chapter 1',
      covers: ['T1'],
      children: [
        { id: 'c1a', title: 'Leaf A' },
        { id: 'c1b', title: 'Leaf B' },
      ],
    },
  ],
}

it('renders the outline tree and auto-selects the first leaf', () => {
  render(<MaterialsScreen outline={OUTLINE} onComplete={jest.fn()} />)
  expect(screen.getByTestId('bid-materials-tree')).toBeInTheDocument()
  // First leaf selected -> its requirements editor is shown.
  expect(screen.getByTestId('bid-materials-requirement')).toBeInTheDocument()
})

it('edits the requirement and reflects completion for the selected node', () => {
  render(<MaterialsScreen outline={OUTLINE} onComplete={jest.fn()} />)
  const req = screen.getByTestId('bid-materials-requirement')
  fireEvent.change(req, { target: { value: 'write something' } })
  expect((req as HTMLTextAreaElement).value).toBe('write something')
})

it('adds a tag on Enter', () => {
  render(<MaterialsScreen outline={OUTLINE} onComplete={jest.fn()} />)
  const tagInput = screen.getByTestId('bid-materials-tag-input')
  fireEvent.change(tagInput, { target: { value: 'quality' } })
  fireEvent.keyDown(tagInput, { key: 'Enter' })
  expect(screen.getByText('quality')).toBeInTheDocument()
})

it('calls onComplete when entering content generation', () => {
  const onComplete = jest.fn()
  render(<MaterialsScreen outline={OUTLINE} onComplete={onComplete} />)
  fireEvent.click(screen.getByTestId('bid-materials-complete-button'))
  expect(onComplete).toHaveBeenCalled()
})
