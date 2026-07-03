// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react'
import { UploadScreen } from '@/features/bid/components/UploadScreen'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

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
  expect(onCreate).toHaveBeenCalledWith('SAMPLE-TENDER', '智慧园区建设项目投标书')
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
  expect(onCreate).toHaveBeenCalledWith('SAMPLE-TENDER', '')
})

it('back button invokes onBack', () => {
  const onBack = jest.fn()
  render(<UploadScreen onCreate={jest.fn()} onBack={onBack} sampleText="SAMPLE" />)
  fireEvent.click(screen.getByTestId('bid-upload-back-button'))
  expect(onBack).toHaveBeenCalled()
})
