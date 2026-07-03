// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')

it('enterAudit then finalizeBid reaches done', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.finalize as jest.Mock).mockResolvedValue({ status: 'finalized' })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('t')
  }) // projectId=9
  act(() => {
    result.current.enterAudit()
  })
  await waitFor(() => expect(result.current.phase).toBe('audit'))
  await act(async () => {
    await result.current.finalizeBid()
  })
  await waitFor(() => expect(result.current.phase).toBe('done'))
  expect(bidApis.finalize).toHaveBeenCalledWith(9)
})

it('finalizeBid failure goes to error phase', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 4 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.finalize as jest.Mock).mockRejectedValue(new Error('resolve gate'))
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('t')
  })
  await act(async () => {
    await result.current.finalizeBid()
  })
  await waitFor(() => expect(result.current.phase).toBe('error'))
  expect(result.current.error).toContain('resolve gate')
})
