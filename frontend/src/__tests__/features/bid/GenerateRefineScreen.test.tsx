import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { GenerateRefineScreen } from '@/features/bid/components/GenerateRefineScreen'
import { bidApis } from '@/apis/bid'

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
  ;(bidApis.getReviewStatus as jest.Mock).mockResolvedValue({ accepted: {} })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({ content: '正文段落。' })
  ;(bidApis.redraftSection as jest.Mock).mockResolvedValue({})
  ;(bidApis.acceptSection as jest.Mock).mockResolvedValue({})
})

test('renders sections by status; done section shows body, progress shows count', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 2,
    finished: false,
    error: null,
    sections: { s1: 'done', c2: 'drafting' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  expect(await screen.findByTestId('bid-generate-document')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('正文段落。')).toBeInTheDocument())
  expect(screen.getByTestId('bid-draft-progress').textContent).toContain('1/2')
})

test('renders full markdown (table + code fence) via EnhancedMarkdown, not parseBody', async () => {
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({
    content: '| 项 | 值 |\n| --- | --- |\n| 报价 | 100 |\n\n```py\nx = 1\n```',
  })
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    finished: true,
    error: null,
    sections: { s1: 'done' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  await screen.findByTestId('bid-generate-document')
  // EnhancedMarkdown routes through react-markdown; the Jest mock for it stamps
  // every render with `data-testid="react-markdown-mock"`. The old parseBody()
  // renderer emits raw <p>/<div> and would NOT produce this marker — so its
  // presence proves the renderer swap, while the text checks prove the table +
  // code-fence lines survive intact (parseBody would have kept them as flat
  // paragraphs and dropped the ``` fence delimiters).
  await waitFor(() => expect(screen.getByTestId('react-markdown-mock')).toBeInTheDocument())
  expect(screen.getByText(/报价 \| 100/)).toBeInTheDocument()
  expect(screen.getByText('x = 1')).toBeInTheDocument()
  // The fence delimiters themselves reach the markdown renderer (parseBody
  // would also have rendered them as paragraph text, so assert via the mock's
  // presence + the code line, which together pin the renderer).
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
