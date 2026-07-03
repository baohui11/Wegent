// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BidWorkbenchDesktop } from '@/app/(tasks)/bid-workbench/BidWorkbenchDesktop'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

it('starts at upload screen and transitions to ready via the sample button', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 1 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({
    tender: { scoring: [{ id: 'S1' }] },
  })

  render(<BidWorkbenchDesktop />)
  expect(screen.getByTestId('bid-upload-screen')).toBeInTheDocument()

  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await waitFor(() => expect(screen.getByTestId('bid-tender-result')).toBeInTheDocument())
})

it('shows the error screen when parse fails, with a retry button', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 1 })
  ;(bidApis.parse as jest.Mock).mockRejectedValue(new Error('boom'))
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })

  render(<BidWorkbenchDesktop />)
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await waitFor(() => expect(screen.getByTestId('bid-error')).toBeInTheDocument())
  expect(screen.getByTestId('bid-retry-button')).toBeInTheDocument()
})

it('builds outline from tender-ready and shows editor', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue({
    outline: { sections: [], volumes: [] },
    coverage: {
      total: 0,
      covered: 0,
      uncovered_scoring: [],
      uncovered_clauses: [],
    },
  })
  render(<BidWorkbenchDesktop />)
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await screen.findByTestId('bid-tender-result')
  fireEvent.click(screen.getByTestId('bid-build-outline-button'))
  await screen.findByTestId('bid-outline-editor')
})

it('enters materials screen after outline next', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
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
  render(<BidWorkbenchDesktop />)
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await screen.findByTestId('bid-tender-result')
  fireEvent.click(screen.getByTestId('bid-build-outline-button'))
  await screen.findByTestId('bid-outline-editor')
  fireEvent.click(screen.getByTestId('outline-next-button')) // coverage clean -> enabled
  await screen.findByTestId('bid-materials-screen')
})

it('starts drafting from materials_done and shows drafting screen', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
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
  render(<BidWorkbenchDesktop />)
  fireEvent.click(screen.getByTestId('bid-upload-sample-button'))
  await screen.findByTestId('bid-tender-result')
  fireEvent.click(screen.getByTestId('bid-build-outline-button'))
  await screen.findByTestId('bid-outline-editor')
  fireEvent.click(screen.getByTestId('outline-next-button'))
  await screen.findByTestId('bid-materials-screen')
  fireEvent.click(screen.getByTestId('bid-materials-complete-button'))
  await screen.findByTestId('bid-start-drafting-button')
  fireEvent.click(screen.getByTestId('bid-start-drafting-button'))
  await screen.findByTestId('bid-drafting-screen')
})
