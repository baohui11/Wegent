// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')

it('enterReview then completeReview', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.completeReview as jest.Mock).mockResolvedValue({ status: 'review_done' })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('t')
  }) // projectId=9
  act(() => {
    result.current.enterReview()
  })
  await waitFor(() => expect(result.current.phase).toBe('review'))
  await act(async () => {
    await result.current.completeReview()
  })
  await waitFor(() => expect(result.current.phase).toBe('review_done'))
  expect(bidApis.completeReview).toHaveBeenCalledWith(9)
})
