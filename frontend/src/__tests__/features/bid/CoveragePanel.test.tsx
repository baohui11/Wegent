// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { CoveragePanel } from '@/features/bid/components/CoveragePanel'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('lists uncovered scoring and clauses', () => {
  render(
    <CoveragePanel
      coverage={{ total: 3, covered: 1, uncovered_scoring: ['S2'], uncovered_clauses: ['V1'] }}
    />
  )
  expect(screen.getByTestId('bid-coverage-panel')).toHaveTextContent('1/3')
  expect(screen.getByTestId('uncovered-S2')).toBeInTheDocument()
  expect(screen.getByTestId('uncovered-V1')).toBeInTheDocument()
})
