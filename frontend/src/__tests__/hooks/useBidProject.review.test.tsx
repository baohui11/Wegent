// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')

it('completeReview advances from the merged drafting phase to audit', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.completeReview as jest.Mock).mockResolvedValue({ status: 'review_done' })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('t')
  }) // projectId=9
  // Review is now merged into the drafting phase (no separate enterReview).
  act(() => {
    result.current.startDrafting()
  })
  await waitFor(() => expect(result.current.phase).toBe('drafting'))
  await act(async () => {
    await result.current.completeReview()
  })
  // Confirming the merged generate-refine phase advances straight to Stage 4 (audit).
  await waitFor(() => expect(result.current.phase).toBe('audit'))
  expect(bidApis.completeReview).toHaveBeenCalledWith(9)
})
