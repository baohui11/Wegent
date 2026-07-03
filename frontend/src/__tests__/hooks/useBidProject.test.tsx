// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')

it('runs create -> parse -> getTender and lands ready', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9, status: 'created' })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({
    tender: { scoring: [{ id: 'S1' }] },
  })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('正文')
  })
  await waitFor(() => expect(result.current.phase).toBe('ready'))
  expect(result.current.tender?.scoring?.[0].id).toBe('S1')
})

it('lands error when parse throws', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockRejectedValue(new Error('boom'))
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('x')
  })
  await waitFor(() => expect(result.current.phase).toBe('error'))
})
