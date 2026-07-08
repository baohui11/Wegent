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
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}))
jest.mock('@/features/common/UserContext', () => ({
  useUser: () => ({ user: { user_name: 'tester', real_name: '测试用户', department_name: null } }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  ;(bidApis.getLlmLog as jest.Mock).mockResolvedValue({ items: [] })
  ;(bidApis.getParseStage as jest.Mock).mockResolvedValue({ stage: 'extracting' })
  ;(bidApis.getGrounding as jest.Mock).mockResolvedValue({ items: {} })
  ;(bidApis.listAttachments as jest.Mock).mockResolvedValue({ items: [] })
  // MaterialsScreen autogen polling defaults (finished immediately) so unrelated
  // tests that mount Materials don't hang on the polling effect.
  ;(bidApis.autoGenerateBriefs as jest.Mock).mockResolvedValue({ status: 'generating' })
  ;(bidApis.getBriefStatus as jest.Mock).mockResolvedValue({
    total: 0,
    nodes: {},
    finished: true,
    error: null,
  })
})

// Helper: land on the list, click "new", reach the standalone new-project screen.
async function enterNewImport() {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([])
  ;(bidApis.listModels as jest.Mock).mockResolvedValue({ items: [] })
  ;(bidApis.getLlmLog as jest.Mock).mockResolvedValue({ items: [] })
  render(<BidWorkbenchDesktop />)
  await screen.findByTestId('bid-project-list')
  fireEvent.click(screen.getByTestId('bid-new-project-button'))
  await screen.findByTestId('bid-upload-screen')
}

// Load the sample file, pick smart naming (no name needed), then create — the
// simplest path from the new-project screen to a parse.
function sampleThenCreate() {
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  fireEvent.click(screen.getByTestId('bid-name-mode-smart'))
  fireEvent.click(screen.getByTestId('bid-start-parse-button'))
}

// Parsing now flows straight into the Stage 1 canvas (outline auto-built).
// A minimal chapter+leaf lets Stage 1's canvas and Stage 2's per-node editor
// render a selectable node.
const OUTLINE_RES = {
  outline: {
    sections: [{ id: 'c1', title: 'Chapter 1', children: [{ id: 'c1a', title: 'Leaf A' }] }],
    volumes: [],
  },
  coverage: { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] },
}

it('lands on the project list by default', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([])
  render(<BidWorkbenchDesktop />)
  await screen.findByTestId('bid-project-list')
  expect(screen.queryByTestId('bid-upload-screen')).not.toBeInTheDocument()
})

it('new -> standalone new-project screen, then sample + create -> ready', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 1 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [{ id: 'S1' }] } })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue(OUTLINE_RES)
  await enterNewImport()
  sampleThenCreate()
  await screen.findByTestId('bid-outline-editor')
})

it('new -> upload a real tender file -> create submits that file text', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 5 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue(OUTLINE_RES)
  // UploadScreen now extracts via the backend; return the deterministic text.
  ;(bidApis.extractTenderText as jest.Mock).mockResolvedValue({
    name: 'tender.txt',
    size: 0,
    text: '我方真实招标文件正文',
  })
  await enterNewImport()
  const file = new File(['我方真实招标文件正文'], 'tender.txt', { type: 'text/plain' })
  fireEvent.change(screen.getByTestId('bid-tender-file'), { target: { files: [file] } })
  await screen.findByText('tender.txt')
  fireEvent.click(screen.getByTestId('bid-name-mode-smart'))
  fireEvent.click(screen.getByTestId('bid-start-parse-button'))
  await screen.findByTestId('bid-outline-editor')
  expect(bidApis.parse).toHaveBeenCalledWith(5, '我方真实招标文件正文')
})

it('back button returns from the new-project screen to the project list', async () => {
  await enterNewImport()
  fireEvent.click(screen.getByTestId('bid-upload-back-button'))
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
  ;(bidApis.getBriefs as jest.Mock).mockResolvedValue({ briefs: {}, materials: [] })
  ;(bidApis.saveBriefs as jest.Mock).mockImplementation((_id: number, d: unknown) =>
    Promise.resolve(d)
  )
  ;(bidApis.listAttachments as jest.Mock).mockResolvedValue({ items: [] })
  render(<BidWorkbenchDesktop />)
  fireEvent.click(await screen.findByTestId('bid-project-card-7'))
  await screen.findByTestId('bid-materials-screen')
  expect(screen.getByTestId('bid-stepper-stage-2')).toHaveAttribute('data-current', 'true')
})

it('materials-next-button persists briefs before opening the confirm dialog', async () => {
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
  ;(bidApis.getBriefs as jest.Mock).mockResolvedValue({ briefs: {}, materials: [] })
  ;(bidApis.saveBriefs as jest.Mock).mockImplementation((_id: number, d: unknown) =>
    Promise.resolve(d)
  )
  ;(bidApis.listAttachments as jest.Mock).mockResolvedValue({ items: [] })
  render(<BidWorkbenchDesktop />)
  fireEvent.click(await screen.findByTestId('bid-project-card-7'))
  await screen.findByTestId('bid-materials-screen')
  fireEvent.click(screen.getByTestId('materials-next-button'))
  // Header must persist the current briefs before the confirm dialog appears.
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  expect(await screen.findByTestId('bid-confirm-ok')).toBeInTheDocument()
})

it('opening a parse_failed project resumes to import panel and parses the existing project', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([
    {
      id: 7,
      title: 'x',
      current_phase: 1,
      max_phase_reached: 1,
      status: 'parse_failed',
      created_at: '2026-07-03T00:00:00Z',
    },
  ])
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsing' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue(OUTLINE_RES)
  render(<BidWorkbenchDesktop />)
  fireEvent.click(await screen.findByTestId('bid-project-card-7'))
  await screen.findByTestId('bid-upload-screen')
  sampleThenCreate()
  await screen.findByTestId('bid-outline-editor')
  expect(bidApis.createProject).not.toHaveBeenCalled()
  expect(bidApis.parse).toHaveBeenCalledWith(7, expect.any(String))
})

it('opening a parsing project mounts the workbench shell and resolves to ready', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([
    {
      id: 8,
      title: 'y',
      current_phase: 1,
      max_phase_reached: 1,
      status: 'parsing',
      created_at: '2026-07-03T00:00:00Z',
    },
  ])
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue(OUTLINE_RES)
  render(<BidWorkbenchDesktop />)
  fireEvent.click(await screen.findByTestId('bid-project-card-8'))
  await screen.findByTestId('bid-workbench-shell')
  await screen.findByTestId('bid-outline-editor')
})

it('shows the error screen when parse fails, with a retry button', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 1 })
  ;(bidApis.parse as jest.Mock).mockRejectedValue(new Error('boom'))
  await enterNewImport()
  sampleThenCreate()
  await waitFor(() => expect(screen.getByTestId('bid-error')).toBeInTheDocument())
  expect(screen.getByTestId('bid-retry-button')).toBeInTheDocument()
})

it('runs the full chain new -> ... -> export download', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 3 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue(OUTLINE_RES)
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
  sampleThenCreate()
  await screen.findByTestId('bid-outline-editor')
  await screen.findByTestId('outline-next-button')
  fireEvent.click(screen.getByTestId('outline-next-button'))
  await screen.findByTestId('bid-materials-screen')
  // Confirm dialog gates the jump to Stage 3 (header owns the single entry).
  fireEvent.click(await screen.findByTestId('materials-next-button'))
  fireEvent.click(await screen.findByTestId('bid-confirm-ok'))
  await screen.findByTestId('bid-generate-refine-screen')
  // Merged generate-refine screen: one header action advances to Stage 4 (check).
  const proceed = await screen.findByTestId('review-next-button')
  // No full-document restart button beside proceed (removed in PR-B — it
  // conflicted with proceed and let users wipe the whole draft).
  expect(screen.queryByTestId('bid-drafting-restart-button')).toBeNull()
  fireEvent.click(proceed)
  await screen.findByTestId('bid-audit-screen')
  // Stage 4 merges audit + export: the Word download lives in the same screen.
  fireEvent.click(await screen.findByTestId('bid-download-button'))
  await waitFor(() => expect(bidApis.downloadBid).toHaveBeenCalledWith(3))
})
