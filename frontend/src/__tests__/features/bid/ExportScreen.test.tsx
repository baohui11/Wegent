// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportScreen } from '@/features/bid/components/ExportScreen'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// jest.config has no clearMocks:true, so isolate call counts per test.
beforeEach(() => {
  jest.clearAllMocks()
})

it('downloads on click and offers back-to-audit', async () => {
  ;(bidApis.downloadBid as jest.Mock).mockResolvedValue(undefined)
  const onReaudit = jest.fn()
  render(<ExportScreen projectId={7} onReaudit={onReaudit} />)
  fireEvent.click(screen.getByTestId('bid-download-button'))
  await waitFor(() => expect(bidApis.downloadBid).toHaveBeenCalledWith(7))
  fireEvent.click(screen.getByTestId('bid-reaudit-button'))
  expect(onReaudit).toHaveBeenCalled()
})

it('shows an error when download fails', async () => {
  ;(bidApis.downloadBid as jest.Mock).mockRejectedValue(new Error('404'))
  render(<ExportScreen projectId={7} onReaudit={jest.fn()} />)
  fireEvent.click(screen.getByTestId('bid-download-button'))
  await waitFor(() => expect(screen.getByTestId('bid-download-error')).toHaveTextContent('404'))
})
