// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { TenderResultView } from '@/features/bid/components/TenderResultView'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('renders scoring rows and red-line clauses', () => {
  render(
    <TenderResultView
      tender={{
        scoring: [{ id: 'S1', weight: 10, target_section: '技术方案' }],
        mandatory_clauses: [{ id: 'V1', veto: true, text: '未盖章即废标' }],
        target_package: { tech_rubric_code: 'JS-001' },
      }}
    />
  )
  expect(screen.getByTestId('bid-scoring-table')).toBeInTheDocument()
  expect(screen.getByText('S1')).toBeInTheDocument()
  expect(screen.getByText('未盖章即废标')).toBeInTheDocument()
  expect(screen.getByText(/JS-001/)).toBeInTheDocument()
})
