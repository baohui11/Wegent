// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DraftingScreen } from '@/features/bid/components/DraftingScreen'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('renders progress + section rows and opens a section', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 2,
    sections: { s1: 'done', s2: 'drafting' },
    finished: true,
    error: null,
  })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({
    id: 's1',
    content: '第一节正文',
  })
  render(<DraftingScreen projectId={5} />)
  await screen.findByTestId('bid-drafting-screen')
  expect(screen.getByTestId('bid-draft-progress')).toHaveTextContent('1/2')
  fireEvent.click(screen.getByTestId('bid-draft-section-s1'))
  await waitFor(() =>
    expect(screen.getByTestId('bid-draft-viewer')).toHaveTextContent('第一节正文')
  )
  expect(bidApis.getSectionContent).toHaveBeenCalledWith(5, 's1')
})
