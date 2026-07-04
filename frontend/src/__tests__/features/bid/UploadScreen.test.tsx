// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UploadScreen } from '@/features/bid/components/UploadScreen'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
jest.mock('@/apis/bid', () => ({
  bidApis: {
    extractTenderText: jest.fn((file: File) =>
      Promise.resolve({ name: file.name, size: file.size, text: `TEXT(${file.name})` })
    ),
    listModels: jest.fn(() => Promise.resolve({ items: [{ name: 'qwen-test' }] })),
  },
}))
import { bidApis } from '@/apis/bid'

it('create is disabled until a tender file is added', () => {
  render(<UploadScreen onCreate={jest.fn()} onBack={jest.fn()} sampleText="SAMPLE" />)
  expect(screen.getByTestId('bid-start-parse-button')).toBeDisabled()
})

it('manual mode: loads sample file, requires a name, then creates with text + name', () => {
  const onCreate = jest.fn()
  render(<UploadScreen onCreate={onCreate} onBack={jest.fn()} sampleText="SAMPLE-TENDER" />)

  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  // File added but name still empty (manual mode) -> create stays disabled.
  expect(screen.getByTestId('bid-start-parse-button')).toBeDisabled()

  fireEvent.change(screen.getByTestId('bid-project-name-input'), {
    target: { value: '智慧园区建设项目投标书' },
  })
  const create = screen.getByTestId('bid-start-parse-button')
  expect(create).not.toBeDisabled()
  fireEvent.click(create)
  expect(onCreate).toHaveBeenCalledWith('SAMPLE-TENDER', '智慧园区建设项目投标书', '')
})

it('smart mode: creates with an empty name so the backend derives it', () => {
  const onCreate = jest.fn()
  render(<UploadScreen onCreate={onCreate} onBack={jest.fn()} sampleText="SAMPLE-TENDER" />)

  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  fireEvent.click(screen.getByTestId('bid-name-mode-smart'))
  // Smart mode needs no name -> create is enabled once a file exists.
  const create = screen.getByTestId('bid-start-parse-button')
  expect(create).not.toBeDisabled()
  fireEvent.click(create)
  expect(onCreate).toHaveBeenCalledWith('SAMPLE-TENDER', '', '')
})

it('back button invokes onBack', () => {
  const onBack = jest.fn()
  render(<UploadScreen onCreate={jest.fn()} onBack={onBack} sampleText="SAMPLE" />)
  fireEvent.click(screen.getByTestId('bid-upload-back-button'))
  expect(onBack).toHaveBeenCalled()
})

it('extracts picked files via the backend and submits their text', async () => {
  const onCreate = jest.fn()
  render(<UploadScreen onCreate={onCreate} onBack={jest.fn()} sampleText="示例" />)
  const input = screen.getByTestId('bid-tender-file')
  const file = new File(['x'], '标书.docx', { type: 'application/whatever' })
  fireEvent.change(input, { target: { files: [file] } })
  await screen.findByText('标书.docx')
  expect(bidApis.extractTenderText).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByTestId('bid-project-name-input'), {
    target: { value: '我的项目' },
  })
  fireEvent.click(screen.getByTestId('bid-start-parse-button'))
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith('TEXT(标书.docx)', '我的项目', ''))
})

it('shows an error state when extraction fails and blocks submit', async () => {
  ;(bidApis.extractTenderText as jest.Mock).mockRejectedValueOnce(new Error('扫描版'))
  render(<UploadScreen onCreate={jest.fn()} onBack={jest.fn()} sampleText="示例" />)
  fireEvent.change(screen.getByTestId('bid-tender-file'), {
    target: { files: [new File(['x'], 'scan.pdf')] },
  })
  await screen.findByText(/扫描版/)
  expect(screen.getByTestId('bid-start-parse-button')).toBeDisabled()
})
