// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AttachmentUploader } from '@/features/bid/components/AttachmentUploader'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('lists items and uploads on file select', async () => {
  ;(bidApis.uploadAttachment as jest.Mock).mockResolvedValue({ name: 'a.pdf', size: 3 })
  const onUploaded = jest.fn()
  render(
    <AttachmentUploader
      projectId={5}
      items={[{ name: 'old.pdf', size: 1 }]}
      onUploaded={onUploaded}
    />
  )
  expect(screen.getByText('old.pdf')).toBeInTheDocument()
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  fireEvent.change(screen.getByTestId('bid-attachment-input'), { target: { files: [file] } })
  await waitFor(() => expect(bidApis.uploadAttachment).toHaveBeenCalledWith(5, file))
  await waitFor(() => expect(onUploaded).toHaveBeenCalled())
})
