// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react'
import { ParsedCallView } from '@/features/bid/components/ParsedCallView'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'zh-CN' },
  }),
}))

it('renders array-of-objects as a readable item list (id + primary text)', () => {
  const response = JSON.stringify({
    qualifications: [
      { id: 'Q-01', requirement: '投标人须具备独立法人资格' },
      { id: 'Q-02', requirement: '须具有 ISO9001 认证' },
    ],
  })
  render(<ParsedCallView response={response} label="qualifications" />)
  expect(screen.getByText('Q-01')).toBeInTheDocument()
  expect(screen.getByText('投标人须具备独立法人资格')).toBeInTheDocument()
  expect(screen.getByText('须具有 ISO9001 认证')).toBeInTheDocument()
})

it('strips ```json fences before parsing', () => {
  const response = '```json\n{"project": {"name": "智慧园区项目"}}\n```'
  render(<ParsedCallView response={response} label="project" />)
  expect(screen.getByText('智慧园区项目')).toBeInTheDocument()
})

it('marks veto clauses', () => {
  const response = JSON.stringify({
    mandatory_clauses: [{ id: 'M1', clause: '投标有效期不少于90天', veto: true }],
  })
  render(<ParsedCallView response={response} label="mandatory_clauses" />)
  expect(screen.getByText('投标有效期不少于90天')).toBeInTheDocument()
  expect(screen.getByText(/废标/)).toBeInTheDocument()
})

it('falls back to raw text when the response is not valid JSON', () => {
  render(<ParsedCallView response="not json at all" label="scoring" />)
  expect(screen.getByText('not json at all')).toBeInTheDocument()
})

it('toggles between parsed and raw JSON views', () => {
  const response = JSON.stringify({ project: { name: '测试项目' } })
  render(<ParsedCallView response={response} label="project" />)
  expect(screen.getByText('测试项目')).toBeInTheDocument()
  fireEvent.click(screen.getByText('outline.view_raw'))
  // raw view shows the JSON braces
  expect(screen.getByText(/"project"/)).toBeInTheDocument()
})
