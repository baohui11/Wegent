// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from '@testing-library/react'
import { DraftingScreen } from '@/features/bid/components/DraftingScreen'
import { bidApis, type OutlineDoc } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.name ?? k) as string,
  }),
}))

const OUTLINE: OutlineDoc = {
  sections: [
    { id: 's1', title: '第一章 总体技术方案' },
    { id: 's2', title: '第二章 数据安全' },
  ],
}

it('renders the document with per-section status and streams done content', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 2,
    sections: { s1: 'done', s2: 'drafting' },
    finished: false,
    error: null,
  })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({
    id: 's1',
    content: '## 第一章\n\n第一节正文段落。',
  })
  render(<DraftingScreen projectId={5} outline={OUTLINE} />)
  await screen.findByTestId('bid-drafting-screen')
  await screen.findByTestId('bid-draft-document')
  expect(screen.getByTestId('bid-draft-progress')).toHaveTextContent('1/2')
  expect(screen.getByTestId('bid-draft-section-s1')).toBeInTheDocument()
  expect(screen.getByTestId('bid-draft-section-s2')).toBeInTheDocument()
  // Done section fetches and renders its body inline.
  await waitFor(() => expect(bidApis.getSectionContent).toHaveBeenCalledWith(5, 's1'))
  await waitFor(() =>
    expect(screen.getByTestId('bid-draft-section-s1')).toHaveTextContent('第一节正文段落。')
  )
})

it('reports generation state to the shell (for the header action)', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    sections: { s1: 'done' },
    finished: true,
    error: null,
  })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({ id: 's1', content: 'body' })
  const onStateChange = jest.fn()
  render(<DraftingScreen projectId={5} outline={OUTLINE} onStateChange={onStateChange} />)
  await waitFor(() => expect(onStateChange).toHaveBeenCalledWith('done'))
})

it('reports the paused state', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 2,
    sections: { s1: 'done', s2: 'drafting' },
    finished: false,
    paused: true,
    error: null,
  })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({ id: 's1', content: 'body' })
  const onStateChange = jest.fn()
  render(<DraftingScreen projectId={5} outline={OUTLINE} onStateChange={onStateChange} />)
  await waitFor(() => expect(onStateChange).toHaveBeenCalledWith('paused'))
})

it('renders the sandbox-flow sequential completion (sections done one-by-one then finished)', async () => {
  // Sandbox drafting (Task 6) writes each section to the status file as the
  // agent produces it, then flips finished:true once all are collected. The
  // contract is unchanged from the frontend's view; this test pins that the
  // screen still drives off the same status shape under the sandbox flow.
  const statuses = [
    {
      total: 2,
      sections: { s1: 'drafting', s2: 'pending' },
      finished: false,
      paused: false,
      error: null,
    },
    {
      total: 2,
      sections: { s1: 'done', s2: 'drafting' },
      finished: false,
      paused: false,
      error: null,
    },
    {
      total: 2,
      sections: { s1: 'done', s2: 'done' },
      finished: true,
      paused: false,
      error: null,
    },
  ]
  let i = 0
  ;(bidApis.getDraftStatus as jest.Mock).mockImplementation(() => {
    const s = statuses[Math.min(i, statuses.length - 1)]
    i += 1
    return Promise.resolve(s)
  })
  ;(bidApis.getSectionContent as jest.Mock).mockImplementation((_pid, id) =>
    Promise.resolve({ id, content: `## ${id}\n\n${id} 正文。` })
  )
  const onStateChange = jest.fn()
  render(<DraftingScreen projectId={7} outline={OUTLINE} onStateChange={onStateChange} />)

  // Eventually the agent finishes both sections and reports the done state.
  await waitFor(() => expect(onStateChange).toHaveBeenCalledWith('done'), { timeout: 4000 })
  expect(screen.getByTestId('bid-draft-progress')).toHaveTextContent('2/2')
  // Both sections rendered with their sandbox-collected bodies.
  await waitFor(() =>
    expect(screen.getByTestId('bid-draft-section-s1')).toHaveTextContent('s1 正文。')
  )
  expect(screen.getByTestId('bid-draft-section-s2')).toHaveTextContent('s2 正文。')
})
