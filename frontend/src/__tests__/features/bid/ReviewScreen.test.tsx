// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewScreen } from '@/features/bid/components/ReviewScreen'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
jest.mock('@/components/common/EnhancedMarkdown', () => ({
  EnhancedMarkdown: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}))

beforeEach(() => {
  ;(bidApis.getDraftSections as jest.Mock).mockResolvedValue({
    items: [{ id: 's1', status: 'done' }],
  })
  ;(bidApis.getReviewStatus as jest.Mock).mockResolvedValue({ accepted: {} })
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    sections: { s1: 'done' },
    finished: true,
    error: null,
  })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({
    id: 's1',
    content: '## 一、方案\n正文',
  })
  ;(bidApis.redraftSection as jest.Mock).mockResolvedValue({ status: 'drafting' })
  ;(bidApis.acceptSection as jest.Mock).mockResolvedValue({ status: 'accepted' })
})

it('opens section, redrafts with instruction, accepts', async () => {
  render(<ReviewScreen projectId={5} />)
  await screen.findByTestId('bid-review-screen')
  fireEvent.click(screen.getByTestId('bid-review-section-s1'))
  await waitFor(() => expect(screen.getByTestId('bid-review-content')).toHaveTextContent('正文'))
  fireEvent.change(screen.getByTestId('bid-review-instruction'), {
    target: { value: '更简洁' },
  })
  fireEvent.click(screen.getByTestId('bid-review-redraft-button'))
  await waitFor(() => expect(bidApis.redraftSection).toHaveBeenCalledWith(5, 's1', '更简洁'))
  fireEvent.click(screen.getByTestId('bid-review-accept-button'))
  await waitFor(() => expect(bidApis.acceptSection).toHaveBeenCalledWith(5, 's1'))
})
