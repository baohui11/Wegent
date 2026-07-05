// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react'
import { WorkbenchShell } from '@/features/bid/components/WorkbenchShell'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('renders title, children, and highlights the stage for the phase', () => {
  render(
    <WorkbenchShell phase="materials" title="政务数据中心" onBack={jest.fn()}>
      <div data-testid="child" />
    </WorkbenchShell>
  )
  expect(screen.getByText('政务数据中心')).toBeInTheDocument()
  expect(screen.getByTestId('child')).toBeInTheDocument()
  // materials maps to stage 2 in the five-stage stepper
  expect(screen.getByTestId('bid-stepper-stage-2')).toHaveAttribute('data-current', 'true')
  expect(screen.getByTestId('bid-stepper-stage-1')).toHaveAttribute('data-current', 'false')
})

it('maps audit/export phases to stage 4', () => {
  render(
    <WorkbenchShell phase="audit" title="x" onBack={jest.fn()}>
      <div />
    </WorkbenchShell>
  )
  expect(screen.getByTestId('bid-stepper-stage-4')).toHaveAttribute('data-current', 'true')
  expect(screen.queryByTestId('bid-stepper-stage-5')).toBeNull()
})

it('fires onBack when the back button is clicked', () => {
  const onBack = jest.fn()
  render(
    <WorkbenchShell phase="import" title="x" onBack={onBack}>
      <div />
    </WorkbenchShell>
  )
  fireEvent.click(screen.getByTestId('bid-workbench-back'))
  expect(onBack).toHaveBeenCalled()
})
