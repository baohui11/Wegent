// SPDX-License-Identifier: Apache-2.0
import { render, screen, fireEvent } from '@testing-library/react'
import { SectionProposalReview } from '@/features/bid/components/SectionProposalReview'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const base = {
  sectionName: '第一章',
  oldContent: 'OLD body',
  newContent: 'NEW body',
  onAccept: jest.fn(),
  onDiscard: jest.fn(),
  onRetry: jest.fn(),
}

test('pending shows the regenerating state — no diff, no gate actions yet', () => {
  render(<SectionProposalReview {...base} pending />)
  expect(screen.getByText('editor.proposal.regenerating')).toBeInTheDocument()
  expect(screen.queryByTestId('bid-proposal-diff')).not.toBeInTheDocument()
  expect(screen.queryByTestId('bid-proposal-accept')).not.toBeInTheDocument()
})

test('ready shows the old→new diff and gates on accept / discard / retry', () => {
  const onAccept = jest.fn()
  const onDiscard = jest.fn()
  const onRetry = jest.fn()
  render(
    <SectionProposalReview
      {...base}
      pending={false}
      onAccept={onAccept}
      onDiscard={onDiscard}
      onRetry={onRetry}
    />
  )
  expect(screen.getByTestId('old-value')).toHaveTextContent('OLD body')
  expect(screen.getByTestId('new-value')).toHaveTextContent('NEW body')

  fireEvent.click(screen.getByTestId('bid-proposal-discard'))
  fireEvent.click(screen.getByTestId('bid-proposal-retry'))
  fireEvent.click(screen.getByTestId('bid-proposal-accept'))
  expect(onDiscard).toHaveBeenCalledTimes(1)
  expect(onRetry).toHaveBeenCalledTimes(1)
  expect(onAccept).toHaveBeenCalledTimes(1)
})
