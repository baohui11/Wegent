import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { GenerateRefineScreen } from '@/features/bid/components/GenerateRefineScreen'
import { bidApis } from '@/apis/bid'
// @tiptap/react + tiptap-markdown + extension packages are mocked globally via
// jest.config.ts moduleNameMapper. The shared mock exposes the last editor
// config on __lastEditorConfig so a test can fire onUpdate (autosave path).
import { __lastEditorConfig } from '@tiptap/react'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const OUTLINE = {
  sections: [
    { id: 'c1', title: '一、方案', children: [{ id: 's1', title: '1. 子节' }] },
    { id: 'c2', title: '二、保障' },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  __lastEditorConfig.current = null
  ;(bidApis.getReviewStatus as jest.Mock).mockResolvedValue({ accepted: {} })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({
    content: '正文段落。',
    version: 'v1',
  })
  ;(bidApis.redraftSection as jest.Mock).mockResolvedValue({})
  ;(bidApis.acceptSection as jest.Mock).mockResolvedValue({})
})

test('renders sections by status; done non-focused section shows body, progress shows count', async () => {
  // Two leaf sections both done: the first (s1) is the default focus and mounts
  // the editor; the second (s2) stays a read view and renders its body text.
  ;(bidApis.getSectionContent as jest.Mock).mockImplementation((_id: number, sid: string) =>
    Promise.resolve({
      id: sid,
      content: sid === 's2' ? '正文段落。' : '聚焦节正文。',
      version: 'v1',
    })
  )
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 2,
    finished: false,
    error: null,
    sections: { s1: 'done', s2: 'done' },
  })
  render(
    <GenerateRefineScreen
      projectId={1}
      outline={
        {
          sections: [
            { id: 'c1', title: '一、方案', children: [{ id: 's1', title: '1.1' }] },
            { id: 'c2', title: '二、保障', children: [{ id: 's2', title: '2.1' }] },
          ],
        } as never
      }
    />
  )
  expect(await screen.findByTestId('bid-generate-document')).toBeInTheDocument()
  // Non-focused section renders its body via EnhancedMarkdown (read view).
  await waitFor(() => expect(screen.getByText('正文段落。')).toBeInTheDocument())
  expect(screen.getByTestId('bid-draft-progress').textContent).toContain('2/2')
})

test('renders full markdown (table + code fence) via EnhancedMarkdown, not parseBody', async () => {
  // Focused section mounts the editor; the non-focused section renders full
  // markdown. Use a two-section outline and seed the non-focused one with a
  // table + code fence to prove EnhancedMarkdown (not parseBody) renders it.
  ;(bidApis.getSectionContent as jest.Mock).mockImplementation((_id: number, sid: string) =>
    Promise.resolve({
      id: sid,
      content:
        sid === 's2'
          ? '| 项 | 值 |\n| --- | --- |\n| 报价 | 100 |\n\n```py\nx = 1\n```'
          : '聚焦节。',
      version: 'v1',
    })
  )
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 2,
    finished: true,
    error: null,
    sections: { s1: 'done', s2: 'done' },
  })
  render(
    <GenerateRefineScreen
      projectId={1}
      outline={
        {
          sections: [
            { id: 'c1', title: '一、方案', children: [{ id: 's1', title: '1.1' }] },
            { id: 'c2', title: '二、保障', children: [{ id: 's2', title: '2.1' }] },
          ],
        } as never
      }
    />
  )
  await screen.findByTestId('bid-generate-document')
  // EnhancedMarkdown routes through react-markdown; the Jest mock for it stamps
  // every render with `data-testid="react-markdown-mock"`. The old parseBody()
  // renderer emits raw <p>/<div> and would NOT produce this marker — so its
  // presence proves the renderer swap, while the text checks prove the table +
  // code-fence lines survive intact.
  await waitFor(() => expect(screen.getByTestId('react-markdown-mock')).toBeInTheDocument())
  expect(screen.getByText(/报价 \| 100/)).toBeInTheDocument()
  expect(screen.getByText('x = 1')).toBeInTheDocument()
})

test('right-panel actions are disabled until the focused section is done', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 2,
    finished: false,
    error: null,
    sections: { s1: 'drafting', c2: 'pending' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  const accept = await screen.findByTestId('bid-review-accept-button')
  expect(accept).toBeDisabled()
})

test('accept a done focused section calls acceptSection', async () => {
  // Single section -> default focus is deterministically s1 (avoids the
  // chapter-vs-leaf ordering of the multi-section case).
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    finished: true,
    error: null,
    sections: { s1: 'done' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  const accept = await screen.findByTestId('bid-review-accept-button')
  await waitFor(() => expect(accept).not.toBeDisabled())
  fireEvent.click(accept)
  await waitFor(() => expect(bidApis.acceptSection).toHaveBeenCalledWith(1, 's1'))
})

test('redraft with instruction calls redraftSection', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    finished: true,
    error: null,
    sections: { s1: 'done' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  const box = await screen.findByTestId('bid-review-instruction')
  fireEvent.change(box, { target: { value: '更凝练' } })
  fireEvent.click(screen.getByTestId('bid-review-redraft-button'))
  await waitFor(() => expect(bidApis.redraftSection).toHaveBeenCalledWith(1, 's1', '更凝练'))
})

test('reports done state to the shell header', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    finished: true,
    error: null,
    sections: { s1: 'done' },
  })
  const onState = jest.fn()
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} onStateChange={onState} />)
  await waitFor(() => expect(onState).toHaveBeenCalledWith('done'))
})

test('editing the focused done section autosaves via saveSection', async () => {
  jest.useFakeTimers()
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({
    id: 's1',
    content: '正文段落。',
    version: 'v1',
  })
  ;(bidApis.saveSection as jest.Mock).mockResolvedValue({ version: 'v2' })
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    finished: true,
    error: null,
    sections: { s1: 'done' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  await screen.findByTestId('bid-section-editor')
  // Fire the mocked editor's onUpdate to simulate an edit.
  act(() =>
    __lastEditorConfig.current?.onUpdate({
      editor: { storage: { markdown: { getMarkdown: () => '改过的正文' } } },
    })
  )
  act(() => jest.advanceTimersByTime(1600))
  await waitFor(() => expect(bidApis.saveSection).toHaveBeenCalledWith(1, 's1', '改过的正文', 'v1'))
  jest.useRealTimers()
})
