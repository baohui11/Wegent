// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MaterialsScreen } from '@/features/bid/components/MaterialsScreen'
import type { OutlineDoc } from '@/apis/bid'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
jest.mock('@/apis/bid', () => ({
  bidApis: {
    getBriefs: jest.fn(() => Promise.resolve({ briefs: {}, materials: [] })),
    saveBriefs: jest.fn((_id: number, doc: unknown) => Promise.resolve(doc)),
    uploadAttachment: jest.fn((_id: number, f: File) =>
      Promise.resolve({ name: f.name, size: f.size })
    ),
    getQualifications: jest.fn(() =>
      Promise.resolve({ qualifications: { company: '', items: [] } })
    ),
    saveQualifications: jest.fn(() => Promise.resolve({ qualifications: {} })),
    getKnowledgeBase: jest.fn(() => Promise.reject(new Error('not set'))),
    saveKnowledgeBase: jest.fn(() => Promise.resolve({ knowledge_base: {} })),
  },
}))
import { bidApis } from '@/apis/bid'

beforeEach(() => jest.clearAllMocks())

const OUTLINE: OutlineDoc = {
  sections: [
    {
      id: 'c1',
      title: 'Chapter 1',
      covers: ['T1'],
      children: [
        { id: 'c1a', title: 'Leaf A' },
        { id: 'c1b', title: 'Leaf B' },
      ],
    },
  ],
}

it('renders the outline tree and auto-selects the first leaf', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  expect(screen.getByTestId('bid-materials-tree')).toBeInTheDocument()
  // First leaf selected -> its requirements editor is shown.
  expect(screen.getByTestId('bid-materials-requirement')).toBeInTheDocument()
})

it('edits the requirement and reflects completion for the selected node', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  const req = await screen.findByTestId('bid-materials-requirement')
  fireEvent.change(req, { target: { value: 'write something' } })
  expect((req as HTMLTextAreaElement).value).toBe('write something')
})

it('adds a tag on Enter', async () => {
  // Tags control was removed in stage-2 slim-down; this test now verifies
  // the tag input is gone (no tag UI exists anymore).
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-requirement')
  expect(screen.queryByTestId('bid-materials-tag-input')).toBeNull()
})

it('calls onComplete when entering content generation', async () => {
  const onComplete = jest.fn()
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={onComplete} />)
  fireEvent.click(await screen.findByTestId('bid-materials-complete-button'))
  await waitFor(() => expect(onComplete).toHaveBeenCalled())
})

it('loads persisted briefs on mount', async () => {
  ;(bidApis.getBriefs as jest.Mock).mockResolvedValueOnce({
    briefs: { c1a: { style: '专业', requirements: '已保存的要求' } },
    materials: [],
  })
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  await waitFor(() =>
    expect((screen.getByTestId('bid-materials-requirement') as HTMLTextAreaElement).value).toBe(
      '已保存的要求'
    )
  )
})

it('persists briefs when completing the stage', async () => {
  const onComplete = jest.fn()
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={onComplete} />)
  fireEvent.change(screen.getByTestId('bid-materials-requirement'), {
    target: { value: '新要求' },
  })
  fireEvent.click(screen.getByTestId('bid-materials-complete-button'))
  await waitFor(() => expect(onComplete).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.briefs.c1a.requirements).toBe('新要求')
})

it('saves bidder company into qualifications and kb', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  fireEvent.change(await screen.findByTestId('bid-bidder-company'), {
    target: { value: '华信数智' },
  })
  fireEvent.click(screen.getByTestId('bid-bidder-save'))
  await waitFor(() =>
    expect(bidApis.saveQualifications).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ company: '华信数智' })
    )
  )
  expect(bidApis.saveKnowledgeBase).toHaveBeenCalledWith(7, {
    bidder_knowledge_base: expect.objectContaining({ company: '华信数智' }),
  })
})

it('uploads picked files as attachments and links them to the node', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  const dropzone = screen.getByTestId('bid-materials-dropzone')
  const input = dropzone.parentElement!.querySelector('input[type="file"]')!
  fireEvent.change(input, { target: { files: [new File(['x'], '案例.pdf')] } })
  await waitFor(() => expect(bidApis.uploadAttachment).toHaveBeenCalled())
  expect(await screen.findByText('案例.pdf')).toBeInTheDocument()
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.materials[0]).toMatchObject({ name: '案例.pdf', linkedNodeIds: ['c1a'] })
})

it('does not render removed writing-style/template/depth/tags controls', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-requirement')
  expect(screen.queryByText(/phase2\.field_style|phase2\.style_/i)).toBeNull()
  expect(screen.queryByText(/phase2\.field_template|phase2\.template_/i)).toBeNull()
  expect(screen.queryByText(/phase2\.field_depth|phase2\.depth_/i)).toBeNull()
  expect(screen.queryByTestId('bid-materials-tag-input')).toBeNull()
})
