// SPDX-License-Identifier: Apache-2.0
import { act, renderHook, waitFor } from '@testing-library/react'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import { bidApis, type OutlineDoc } from '@/apis/bid'

jest.mock('@/apis/bid')
const api = bidApis as jest.Mocked<typeof bidApis>

const STAGE1: OutlineDoc = { sections: [{ id: 's1', title: '第一章' }], volumes: [] }

beforeEach(() => {
  jest.clearAllMocks()
  api.getTender.mockResolvedValue({ tender: {} })
  api.getOutline.mockResolvedValue({ outline: STAGE1, coverage: {} as never })
  api.getOutlineStage3.mockResolvedValue({ outline: STAGE1, differs_from_stage1: false })
  api.saveOutlineStage3.mockResolvedValue({
    outline: { sections: [{ id: 's1', title: '改过' }] },
    differs_from_stage1: true,
  })
})

it('loads stage3 on open when the project has reached drafting', async () => {
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open({
      id: 1,
      current_phase: 5,
      max_phase_reached: 5,
      status: 'review',
    } as never)
  })
  await waitFor(() => expect(api.getOutlineStage3).toHaveBeenCalledWith(1))
  expect(result.current.maxPhaseReached).toBe(5)
})

it('renameSection writes stage3, not stage1', async () => {
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open({
      id: 1,
      current_phase: 4,
      max_phase_reached: 4,
      status: 'drafting',
    } as never)
  })
  await act(async () => {
    await result.current.renameSection('s1', '改过')
  })
  expect(api.saveOutlineStage3).toHaveBeenCalledWith(1, expect.anything())
  expect(api.saveOutline).not.toHaveBeenCalled()
  expect(result.current.stage3Outline?.sections?.[0]?.title).toBe('改过')
  expect(result.current.stage3Differs).toBe(true)
})

it('addChapter appends to stage3 and redrafts the new chapter with the brief', async () => {
  api.redraftSection.mockResolvedValue({ status: 'drafting' })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open({
      id: 1,
      current_phase: 4,
      max_phase_reached: 4,
      status: 'drafting',
    } as never)
  })
  await act(async () => {
    await result.current.addChapter('新增章', '突出安全')
  })
  const saved = api.saveOutlineStage3.mock.calls.at(-1)![1]
  const added = saved.sections!.at(-1)!
  expect(added.title).toBe('新增章')
  expect(api.redraftSection).toHaveBeenCalledWith(1, added.id, '突出安全')
})

it('deleteChapter removes from stage3 and deletes the section', async () => {
  api.deleteSection.mockResolvedValue({ status: 'deleted' })
  const { result } = renderHook(() => useBidProject())
  await act(async () => {
    await result.current.open({
      id: 1,
      current_phase: 4,
      max_phase_reached: 4,
      status: 'drafting',
    } as never)
  })
  await act(async () => {
    await result.current.deleteChapter('s1')
  })
  const saved = api.saveOutlineStage3.mock.calls.at(-1)![1]
  expect(saved.sections!.some(s => s.id === 's1')).toBe(false)
  expect(api.deleteSection).toHaveBeenCalledWith(1, 's1')
})
