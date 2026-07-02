// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BidWorkbenchDesktop } from '@/app/(tasks)/bid-workbench/BidWorkbenchDesktop'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('starts at upload screen and transitions to ready via the sample button', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 1 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({
    tender: { scoring: [{ id: 'S1' }] },
  })

  render(<BidWorkbenchDesktop />)
  expect(screen.getByTestId('bid-upload-screen')).toBeInTheDocument()

  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await waitFor(() => expect(screen.getByTestId('bid-tender-result')).toBeInTheDocument())
})

it('shows the error screen when parse fails, with a retry button', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 1 })
  ;(bidApis.parse as jest.Mock).mockRejectedValue(new Error('boom'))
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })

  render(<BidWorkbenchDesktop />)
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await waitFor(() => expect(screen.getByTestId('bid-error')).toBeInTheDocument())
  expect(screen.getByTestId('bid-retry-button')).toBeInTheDocument()
})
