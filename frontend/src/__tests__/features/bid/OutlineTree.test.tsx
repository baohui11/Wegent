// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react'
import { OutlineTree } from '@/features/bid/components/OutlineTree'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('edits title and bubbles onChange', () => {
  const onChange = jest.fn()
  render(<OutlineTree nodes={[{ title: '一', covers: [] }]} onChange={onChange} />)
  fireEvent.change(screen.getAllByTestId('outline-node-title')[0], {
    target: { value: '一章' },
  })
  expect(onChange).toHaveBeenCalledWith([{ title: '一章', covers: [] }])
})

it('deletes a node', () => {
  const onChange = jest.fn()
  render(<OutlineTree nodes={[{ title: 'a' }, { title: 'b' }]} onChange={onChange} />)
  fireEvent.click(screen.getAllByTestId('outline-node-delete')[0])
  expect(onChange).toHaveBeenCalledWith([{ title: 'b' }])
})

it('edits covers via comma input', () => {
  const onChange = jest.fn()
  render(<OutlineTree nodes={[{ title: 'a', covers: ['S1'] }]} onChange={onChange} />)
  fireEvent.change(screen.getAllByTestId('outline-node-covers')[0], {
    target: { value: 'S1, S2' },
  })
  expect(onChange).toHaveBeenCalledWith([{ title: 'a', covers: ['S1', 'S2'] }])
})
