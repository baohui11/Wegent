// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')

it('startDrafting triggers draft and sets phase', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.startDraft as jest.Mock).mockResolvedValue({ status: 'drafting' })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('t')
  }) // projectId=9
  await act(async () => {
    await result.current.startDrafting()
  })
  await waitFor(() => expect(result.current.phase).toBe('drafting'))
  expect(bidApis.startDraft).toHaveBeenCalledWith(9)
})
