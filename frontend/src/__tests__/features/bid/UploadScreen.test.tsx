// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react'
import { UploadScreen } from '@/features/bid/components/UploadScreen'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('start-parse is disabled until tender text is entered', () => {
  render(<UploadScreen onSubmit={jest.fn()} onUseSample={jest.fn()} sampleText="SAMPLE" />)
  const start = screen.getByTestId('bid-start-parse-button')
  expect(start).toBeDisabled()
})

it('submits the pasted tender text and package', () => {
  const onSubmit = jest.fn()
  render(<UploadScreen onSubmit={onSubmit} onUseSample={jest.fn()} sampleText="SAMPLE" />)
  fireEvent.change(screen.getByTestId('bid-tender-input'), {
    target: { value: '真实招标文件正文' },
  })
  fireEvent.change(screen.getByTestId('bid-package-input'), { target: { value: 'A包' } })
  fireEvent.click(screen.getByTestId('bid-start-parse-button'))
  expect(onSubmit).toHaveBeenCalledWith('真实招标文件正文', 'A包')
})

it('the sample button fills the textarea and calls onUseSample with the package', () => {
  const onUseSample = jest.fn()
  render(<UploadScreen onSubmit={jest.fn()} onUseSample={onUseSample} sampleText="SAMPLE-TENDER" />)
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  expect(onUseSample).toHaveBeenCalledWith('')
  // sample text is loaded into the textarea so the user can see/edit it
  expect((screen.getByTestId('bid-tender-input') as HTMLTextAreaElement).value).toBe(
    'SAMPLE-TENDER'
  )
})
