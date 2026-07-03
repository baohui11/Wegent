// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuditScreen } from '@/features/bid/components/AuditScreen'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// jest.config has no clearMocks:true, so isolate call counts per test (matches
// the ReviewScreen.test.tsx convention) — otherwise calls accumulate across
// `it` blocks within this file.
beforeEach(() => {
  jest.clearAllMocks()
})

const REPORT = {
  verdict: 'NEED_FIX_VETO',
  summary: { total_issues: 2, veto_issues: 1, high_issues: 1, scoring_coverage: '3/4' },
  checks: [
    {
      check: 'numbers',
      ok: false,
      issues: [{ desc: '投标函金额不一致', severity: 'high', veto: true }],
    },
    { check: 'coverage', ok: true, issues: [] },
  ],
}

it('runs audit on mount, shows verdict/issues, wires rework and finalize', async () => {
  ;(bidApis.runAudit as jest.Mock).mockResolvedValue(REPORT)
  const onRework = jest.fn()
  const onFinalize = jest.fn()
  render(<AuditScreen projectId={5} onRework={onRework} onFinalize={onFinalize} />)

  await screen.findByTestId('bid-audit-screen')
  expect(bidApis.runAudit).toHaveBeenCalledWith(5)
  expect(screen.getByTestId('bid-audit-verdict')).toHaveTextContent('phase6.verdict_NEED_FIX_VETO')
  expect(screen.getByTestId('bid-audit-check-numbers')).toHaveTextContent('投标函金额不一致')
  expect(screen.getByTestId('bid-audit-veto-warning')).toBeInTheDocument()

  fireEvent.click(screen.getByTestId('bid-audit-rework-button'))
  expect(onRework).toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('bid-audit-finalize-button'))
  expect(onFinalize).toHaveBeenCalled()
})

it('re-runs audit when rerun clicked', async () => {
  ;(bidApis.runAudit as jest.Mock).mockResolvedValue(REPORT)
  render(<AuditScreen projectId={5} onRework={jest.fn()} onFinalize={jest.fn()} />)
  await screen.findByTestId('bid-audit-screen')
  fireEvent.click(screen.getByTestId('bid-audit-rerun-button'))
  await waitFor(() => expect(bidApis.runAudit).toHaveBeenCalledTimes(2))
})

it('deep-verifies and refreshes the report with fidelity issues', async () => {
  ;(bidApis.runAudit as jest.Mock).mockResolvedValue({
    verdict: 'NEED_FIX',
    summary: { total_issues: 0, veto_issues: 0, high_issues: 0, scoring_coverage: '4/4' },
    checks: [{ check: 'source_fidelity', ok: true, issues: [] }],
  })
  ;(bidApis.verifyAudit as jest.Mock).mockResolvedValue({
    verdict: 'NEED_FIX_VETO',
    summary: { total_issues: 1, veto_issues: 1, high_issues: 0, scoring_coverage: '4/4' },
    checks: [
      {
        check: 'source_fidelity',
        ok: false,
        issues: [{ desc: '红线条款与原文不符', severity: 'high', veto: true }],
      },
    ],
  })
  render(<AuditScreen projectId={5} onRework={jest.fn()} onFinalize={jest.fn()} />)
  await screen.findByTestId('bid-audit-screen')

  fireEvent.click(screen.getByTestId('bid-audit-verify-button'))
  await waitFor(() => expect(bidApis.verifyAudit).toHaveBeenCalledWith(5))
  // report replaced with the folded one -> fidelity issue now visible + verdict upgraded
  await waitFor(() =>
    expect(screen.getByTestId('bid-audit-check-source_fidelity')).toHaveTextContent(
      '红线条款与原文不符'
    )
  )
  expect(screen.getByTestId('bid-audit-verdict')).toHaveTextContent('phase6.verdict_NEED_FIX_VETO')
})
