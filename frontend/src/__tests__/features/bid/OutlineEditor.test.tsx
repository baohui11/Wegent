// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react'
import { OutlineEditor } from '@/features/bid/components/OutlineEditor'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const cov0 = { total: 1, covered: 0, uncovered_scoring: ['S1'], uncovered_clauses: [] }
const covOk = { total: 1, covered: 1, uncovered_scoring: [], uncovered_clauses: [] }

it('next is disabled while uncovered, save bubbles draft', () => {
  const onSave = jest.fn()
  render(
    <OutlineEditor
      outline={{ sections: [{ title: 'a', covers: [] }], volumes: [] }}
      coverage={cov0}
      onSave={onSave}
      onNext={jest.fn()}
    />
  )
  expect(screen.getByTestId('outline-next-button')).toBeDisabled()
  fireEvent.click(screen.getByTestId('outline-save-button'))
  expect(onSave).toHaveBeenCalledWith({
    sections: [{ title: 'a', covers: [] }],
    volumes: [],
  })
})

it('next enabled when coverage clean', () => {
  render(
    <OutlineEditor
      outline={{ sections: [], volumes: [] }}
      coverage={covOk}
      onSave={jest.fn()}
      onNext={jest.fn()}
    />
  )
  expect(screen.getByTestId('outline-next-button')).not.toBeDisabled()
})
