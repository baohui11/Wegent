// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis, type BidProject } from '@/apis/bid'

jest.mock('@/apis/bid')

const proj = (over: Partial<BidProject>): BidProject => ({
  id: 5,
  title: 't',
  current_phase: 1,
  max_phase_reached: 1,
  status: 'created',
  created_at: '2026-07-03T00:00:00Z',
  ...over,
})

beforeEach(() => jest.clearAllMocks())

it('phase1 created -> import', async () => {
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open(proj({ current_phase: 1, status: 'created' }))
  })
  expect(result.current.phase).toBe('import')
  expect(result.current.projectId).toBe(5)
})

it('phase2 without outline -> builds it and lands on the canvas', async () => {
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
  ;(bidApis.getOutline as jest.Mock).mockRejectedValue(new Error('404'))
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue({
    outline: { sections: [] },
    coverage: { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] },
  })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open(proj({ current_phase: 2, status: 'parsed' }))
  })
  await waitFor(() => expect(result.current.phase).toBe('outline_ready'))
  expect(bidApis.getTender).toHaveBeenCalledWith(5)
  expect(bidApis.buildOutline).toHaveBeenCalledWith(5)
})

it('phase2 with outline -> outline_ready', async () => {
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.getOutline as jest.Mock).mockResolvedValue({
    outline: { sections: [], volumes: [] },
    coverage: { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] },
  })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open(proj({ current_phase: 2, status: 'parsed' }))
  })
  await waitFor(() => expect(result.current.phase).toBe('outline_ready'))
  expect(bidApis.getOutline).toHaveBeenCalledWith(5)
  expect(result.current.outline).toEqual({ sections: [], volumes: [] })
  expect(result.current.coverage).toEqual({
    total: 0,
    covered: 0,
    uncovered_scoring: [],
    uncovered_clauses: [],
  })
})

it('phase3 -> materials', async () => {
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open(proj({ current_phase: 3, status: 'parsed' }))
  })
  expect(result.current.phase).toBe('materials')
})

it('phase4 drafting -> drafting, else materials', async () => {
  const { result: r1 } = renderHook(() => useBidProject())
  await act(async () => {
    await r1.current.open(proj({ current_phase: 4, status: 'drafting' }))
  })
  expect(r1.current.phase).toBe('drafting')

  const { result: r2 } = renderHook(() => useBidProject())
  await act(async () => {
    await r2.current.open(proj({ current_phase: 4, status: 'parsed' }))
  })
  expect(r2.current.phase).toBe('materials')
})

it('phase5 -> review, phase6 -> audit, phase7 -> done', async () => {
  const { result: r5 } = renderHook(() => useBidProject())
  await act(async () => {
    await r5.current.open(proj({ current_phase: 5 }))
  })
  expect(r5.current.phase).toBe('review')

  const { result: r6 } = renderHook(() => useBidProject())
  await act(async () => {
    await r6.current.open(proj({ current_phase: 6 }))
  })
  expect(r6.current.phase).toBe('audit')

  const { result: r7 } = renderHook(() => useBidProject())
  await act(async () => {
    await r7.current.open(proj({ current_phase: 7 }))
  })
  expect(r7.current.phase).toBe('done')
})

it('phase1 parsing -> polls, builds outline, lands on the canvas', async () => {
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue({
    outline: { sections: [] },
    coverage: { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] },
  })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open(proj({ current_phase: 1, status: 'parsing' }))
  })
  await waitFor(() => expect(result.current.phase).toBe('outline_ready'))
  expect(bidApis.getTender).toHaveBeenCalledWith(5)
  expect(bidApis.buildOutline).toHaveBeenCalledWith(5)
})

it('open lands error when getTender throws', async () => {
  ;(bidApis.getTender as jest.Mock).mockRejectedValue(new Error('boom'))
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open(proj({ current_phase: 2, status: 'parsed' }))
  })
  await waitFor(() => expect(result.current.phase).toBe('error'))
  expect(result.current.error).toBe('boom')
})
