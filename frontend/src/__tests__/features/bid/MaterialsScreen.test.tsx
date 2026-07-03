// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MaterialsScreen } from '@/features/bid/components/MaterialsScreen'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

beforeEach(() => {
  ;(bidApis.getKnowledgeBase as jest.Mock).mockResolvedValue({
    knowledge_base: { bidder_knowledge_base: {} },
  })
  ;(bidApis.getQualifications as jest.Mock).mockResolvedValue({
    qualifications: { company: '', items: {} },
  })
  ;(bidApis.listAttachments as jest.Mock).mockResolvedValue({ items: [] })
  ;(bidApis.saveKnowledgeBase as jest.Mock).mockResolvedValue({ knowledge_base: {} })
})

it('loads then saves knowledge base', async () => {
  render(<MaterialsScreen projectId={5} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-screen')
  fireEvent.click(screen.getByTestId('bid-save-kb-button'))
  await waitFor(() => expect(bidApis.saveKnowledgeBase).toHaveBeenCalled())
})

it('calls onComplete on 进入起草', async () => {
  const onComplete = jest.fn()
  render(<MaterialsScreen projectId={5} onComplete={onComplete} />)
  await screen.findByTestId('bid-materials-screen')
  fireEvent.click(screen.getByTestId('bid-materials-complete-button'))
  expect(onComplete).toHaveBeenCalled()
})
