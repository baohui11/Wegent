// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react'
import { JsonEditor } from '@/features/bid/components/JsonEditor'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('valid json fires onValidChange, invalid shows error', () => {
  const onValid = jest.fn()
  render(<JsonEditor label="kb" value={{ a: 1 }} onValidChange={onValid} />)
  const ta = screen.getByTestId('json-editor-kb')
  fireEvent.change(ta, { target: { value: '{"a": 2}' } })
  expect(onValid).toHaveBeenLastCalledWith({ a: 2 })
  fireEvent.change(ta, { target: { value: '{bad' } })
  expect(screen.getByTestId('json-editor-error-kb')).toBeInTheDocument()
  // invalid: no further callback with new value
  expect(onValid).toHaveBeenLastCalledWith({ a: 2 })
})
