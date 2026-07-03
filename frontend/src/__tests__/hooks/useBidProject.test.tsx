// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')

const OUTLINE_RES = {
  outline: { sections: [], volumes: [] },
  coverage: { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] },
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('runs create -> parse -> build outline and lands on the canvas', async () => {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9, status: 'created' })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({
    tender: { scoring: [{ id: 'S1' }] },
  })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue(OUTLINE_RES)
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.startFromText('正文')
  })
  await waitFor(() => expect(result.current.phase).toBe('outline_ready'))
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

it('startNew moves to import phase with no project', () => {
  const { result } = renderHook(() => useBidProject())
  act(() => {
    result.current.startNew()
  })
  expect(result.current.phase).toBe('import')
  expect(result.current.projectId).toBeNull()
})

it('parseExisting parses an already-created project and lands on the canvas', async () => {
  ;(bidApis.declarePackage as jest.Mock).mockResolvedValue({ status: 'ok' })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsing' })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue(OUTLINE_RES)
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.parseExisting(7, '正文', 'A包')
  })
  await waitFor(() => expect(result.current.phase).toBe('outline_ready'))
  expect(bidApis.declarePackage).toHaveBeenCalledWith(7, 'A包')
  expect(bidApis.parse).toHaveBeenCalledWith(7, '正文')
  expect(bidApis.createProject).not.toHaveBeenCalled()
})
