// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BidWorkbenchDesktop } from '@/app/(tasks)/bid-workbench/BidWorkbenchDesktop'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
jest.mock('@/components/common/EnhancedMarkdown', () => ({
  EnhancedMarkdown: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}))

beforeEach(() => jest.clearAllMocks())

// Helper: land on the list, click "new", reach the in-shell import panel.
async function enterNewImport() {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([])
  render(<BidWorkbenchDesktop />)
  await screen.findByTestId('bid-project-list')
  fireEvent.click(screen.getByTestId('bid-new-project-button'))
  await screen.findByTestId('bid-workbench-shell')
  await screen.findByTestId('bid-upload-screen')
}

it('lands on the project list by default', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([])
  render(<BidWorkbenchDesktop />)
  await screen.findByTestId('bid-project-list')
  expect(screen.queryByTestId('bid-upload-screen')).not.toBeInTheDocument()
})

it('new -> import panel inside the shell, then sample -> ready', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 1 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [{ id: 'S1' }] } })
  await enterNewImport()
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await waitFor(() => expect(screen.getByTestId('bid-tender-result')).toBeInTheDocument())
})

it('back button returns from the shell to the project list', async () => {
  await enterNewImport()
  fireEvent.click(screen.getByTestId('bid-workbench-back'))
  await screen.findByTestId('bid-project-list')
})

it('opening a phase-3 project resumes at the materials screen', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([
    {
      id: 7,
      title: '政务',
      current_phase: 3,
      max_phase_reached: 3,
      status: 'parsed',
      created_at: '2026-07-03T00:00:00Z',
    },
  ])
  ;(bidApis.getKnowledgeBase as jest.Mock).mockResolvedValue({
    knowledge_base: { bidder_knowledge_base: {} },
  })
  ;(bidApis.getQualifications as jest.Mock).mockResolvedValue({
    qualifications: { company: '', items: {} },
  })
  ;(bidApis.listAttachments as jest.Mock).mockResolvedValue({ items: [] })
  render(<BidWorkbenchDesktop />)
  fireEvent.click(await screen.findByTestId('bid-project-card-7'))
  await screen.findByTestId('bid-materials-screen')
  expect(screen.getByTestId('bid-stepper-gate-3')).toHaveAttribute('data-current', 'true')
})

it('shows the error screen when parse fails, with a retry button', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 1 })
  ;(bidApis.parse as jest.Mock).mockRejectedValue(new Error('boom'))
  await enterNewImport()
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await waitFor(() => expect(screen.getByTestId('bid-error')).toBeInTheDocument())
  expect(screen.getByTestId('bid-retry-button')).toBeInTheDocument()
})

it('runs the full chain new -> ... -> export download', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 3 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue({
    outline: { sections: [], volumes: [] },
    coverage: { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] },
  })
  ;(bidApis.getKnowledgeBase as jest.Mock).mockResolvedValue({
    knowledge_base: { bidder_knowledge_base: {} },
  })
  ;(bidApis.getQualifications as jest.Mock).mockResolvedValue({
    qualifications: { company: '', items: {} },
  })
  ;(bidApis.listAttachments as jest.Mock).mockResolvedValue({ items: [] })
  ;(bidApis.completeMaterials as jest.Mock).mockResolvedValue({ status: 'materials_done' })
  ;(bidApis.startDraft as jest.Mock).mockResolvedValue({ status: 'drafting' })
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    sections: { s1: 'done' },
    finished: true,
    error: null,
  })
  ;(bidApis.getDraftSections as jest.Mock).mockResolvedValue({
    items: [{ id: 's1', status: 'done' }],
  })
  ;(bidApis.getReviewStatus as jest.Mock).mockResolvedValue({ accepted: {} })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({ id: 's1', content: '正文' })
  ;(bidApis.completeReview as jest.Mock).mockResolvedValue({ status: 'review_done' })
  ;(bidApis.runAudit as jest.Mock).mockResolvedValue({
    verdict: 'PASS',
    summary: { total_issues: 0, veto_issues: 0, high_issues: 0, scoring_coverage: '1/1' },
    checks: [{ check: 'coverage', ok: true, issues: [] }],
  })
  ;(bidApis.finalize as jest.Mock).mockResolvedValue({ status: 'finalized' })
  ;(bidApis.downloadBid as jest.Mock).mockResolvedValue(undefined)

  await enterNewImport()
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await screen.findByTestId('bid-tender-result')
  fireEvent.click(screen.getByTestId('bid-build-outline-button'))
  await screen.findByTestId('bid-outline-editor')
  fireEvent.click(screen.getByTestId('outline-next-button'))
  await screen.findByTestId('bid-materials-screen')
  fireEvent.click(screen.getByTestId('bid-materials-complete-button'))
  await screen.findByTestId('bid-materials-done')
  fireEvent.click(screen.getByTestId('bid-start-drafting-button'))
  await screen.findByTestId('bid-drafting-screen')
  await screen.findByTestId('bid-drafting-next-button')
  fireEvent.click(screen.getByTestId('bid-drafting-next-button'))
  await screen.findByTestId('bid-review-screen')
  fireEvent.click(screen.getByTestId('bid-review-complete-button'))
  await screen.findByTestId('bid-review-done')
  fireEvent.click(screen.getByTestId('bid-enter-audit-button'))
  await screen.findByTestId('bid-audit-screen')
  fireEvent.click(screen.getByTestId('bid-audit-finalize-button'))
  await screen.findByTestId('bid-export-screen')
  fireEvent.click(screen.getByTestId('bid-download-button'))
  await waitFor(() => expect(bidApis.downloadBid).toHaveBeenCalledWith(3))
})
