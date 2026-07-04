// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis } from '@/apis/bid'

jest.mock('@/apis/bid')

async function toOutlineReady(result: { current: ReturnType<typeof useBidProject> }) {
  ;(bidApis.createProject as jest.Mock).mockResolvedValue({ id: 9 })
  ;(bidApis.getProject as jest.Mock).mockResolvedValue({ status: 'parsed', current_phase: 2 })
  ;(bidApis.parse as jest.Mock).mockResolvedValue({ status: 'parsed' })
  ;(bidApis.getTender as jest.Mock).mockResolvedValue({ tender: {} })
  ;(bidApis.buildOutline as jest.Mock).mockResolvedValue({
    outline: {},
    coverage: { total: 0, covered: 0, uncovered_scoring: [], uncovered_clauses: [] },
  })
  await act(async () => {
    await result.current.startFromText('t')
  })
  await act(async () => {
    await result.current.buildOutline()
  })
}

it('enterMaterials then completeMaterials advances straight to drafting', async () => {
  ;(bidApis.completeMaterials as jest.Mock).mockResolvedValue({ status: 'materials_done' })
  ;(bidApis.startDraft as jest.Mock).mockResolvedValue({ status: 'drafting' })
  const { result } = renderHook(() => useBidProject())
  await toOutlineReady(result)
  act(() => {
    result.current.enterMaterials()
  })
  await waitFor(() => expect(result.current.phase).toBe('materials'))
  await act(async () => {
    await result.current.completeMaterials()
  })
  await waitFor(() => expect(result.current.phase).toBe('drafting'))
  expect(bidApis.completeMaterials).toHaveBeenCalledWith(9)
  expect(bidApis.startDraft).toHaveBeenCalledWith(9)
})
