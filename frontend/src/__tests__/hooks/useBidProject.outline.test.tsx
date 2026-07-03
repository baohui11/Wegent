// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')

it('declares package before parse when provided', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.declarePackage as jest.Mock).mockResolvedValue({ status: 'declared' })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('正文', '包件二')
  })
  expect(bidApis.declarePackage).toHaveBeenCalledWith(9, '包件二')
  await waitFor(() => expect(result.current.phase).toBe('ready'))
})

it('buildOutline moves to outline_ready with coverage', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue({
    outline: { sections: [{ id: 'a' }] },
    coverage: {
      total: 1,
      covered: 1,
      uncovered_scoring: [],
      uncovered_clauses: [],
    },
  })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('正文')
  })
  await act(async () => {
    await result.current.buildOutline()
  })
  await waitFor(() => expect(result.current.phase).toBe('outline_ready'))
  expect(result.current.outline?.sections?.[0].id).toBe('a')
  expect(result.current.coverage?.covered).toBe(1)
})
