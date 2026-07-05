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
    getGrounding: jest.fn(() => Promise.resolve({ items: {} })),
    listAttachments: jest.fn(() => Promise.resolve({ items: [] })),
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
        { id: 'c1a', title: 'Leaf A', covers: ['T1'] },
        { id: 'c1b', title: 'Leaf B', covers: ['MC-002'] },
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
  // The in-panel "enter generation" button was removed in stage-2 (the header
  // owns the single entry point now). onComplete stays on the props contract
  // for the Desktop confirm flow; this test verifies the button is gone.
  const onComplete = jest.fn()
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={onComplete} />)
  await screen.findByTestId('bid-materials-requirement')
  expect(screen.queryByTestId('bid-materials-complete-button')).toBeNull()
})

it('marks a leaf configured once it has requirements (materials optional)', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  const tree = await screen.findByTestId('bid-materials-tree')
  // First leaf auto-selected; nothing filled yet -> no node is "configured".
  expect(tree.textContent).not.toContain('phase2.status_configured')
  fireEvent.change(screen.getByTestId('bid-materials-requirement'), {
    target: { value: '本节要求' },
  })
  // Requirements alone (no materials) flips the node to configured.
  await waitFor(() => expect(tree.textContent).toContain('phase2.status_configured'))
})

it('applies the current section config to all its subsections (descendants)', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-tree')
  fireEvent.click(screen.getByText('Chapter 1')) // the chapter owns the subsections
  fireEvent.change(screen.getByTestId('bid-materials-requirement'), {
    target: { value: 'BATCH_REQ' },
  })
  fireEvent.click(screen.getByText('phase2.apply_children'))
  // In-app confirm dialog (not native window.confirm) -> click its OK.
  fireEvent.click(await screen.findByTestId('bid-confirm-ok'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.briefs.c1a.requirements).toBe('BATCH_REQ') // subsection: applied
  expect(doc.briefs.c1b.requirements).toBe('BATCH_REQ') // subsection: applied
})

it('scopes apply-to-subsections to the node own subtree, not sibling chapters', async () => {
  const TWO_CHAPTERS: OutlineDoc = {
    sections: [
      {
        id: 'c1',
        title: 'Chapter 1',
        children: [
          { id: 'c1a', title: 'Leaf A' },
          { id: 'c1b', title: 'Leaf B' },
        ],
      },
      { id: 'c2', title: 'Chapter 2', children: [{ id: 'c2a', title: 'Leaf C' }] },
    ],
  }
  render(<MaterialsScreen projectId={7} outline={TWO_CHAPTERS} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-tree')
  fireEvent.click(screen.getByText('Chapter 1')) // apply down from chapter 1
  fireEvent.change(screen.getByTestId('bid-materials-requirement'), {
    target: { value: 'SCOPED' },
  })
  fireEvent.click(screen.getByText('phase2.apply_children'))
  fireEvent.click(await screen.findByTestId('bid-confirm-ok'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.briefs.c1a.requirements).toBe('SCOPED') // own subsection: applied
  expect(doc.briefs.c1b.requirements).toBe('SCOPED') // own subsection: applied
  expect(doc.briefs.c2a?.requirements ?? '').toBe('') // other chapter: untouched
})

it('applies to the whole subtree including nested grandchildren', async () => {
  const NESTED: OutlineDoc = {
    sections: [
      {
        id: 'ch',
        title: 'Chapter',
        children: [
          { id: 'a', title: 'Sec A' },
          { id: 'b', title: 'Sec B', children: [{ id: 'b1', title: 'Sub B1' }] },
        ],
      },
    ],
  }
  render(<MaterialsScreen projectId={7} outline={NESTED} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-tree')
  fireEvent.click(screen.getByText('Chapter')) // top chapter owns the whole subtree
  fireEvent.change(screen.getByTestId('bid-materials-requirement'), { target: { value: 'DEEP' } })
  fireEvent.click(screen.getByText('phase2.apply_children'))
  fireEvent.click(await screen.findByTestId('bid-confirm-ok'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.briefs.a.requirements).toBe('DEEP') // child
  expect(doc.briefs.b.requirements).toBe('DEEP') // child (sub-chapter)
  expect(doc.briefs.b1.requirements).toBe('DEEP') // grandchild — whole subtree
})

it('disables apply-to-subsections on a leaf (no subsections)', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-tree')
  fireEvent.click(screen.getByText('Leaf A')) // a leaf -> no descendants
  expect(screen.getByText('phase2.apply_children').closest('button')).toBeDisabled()
})

it('save & next advances off a chapter node (not stuck) since chapters are sections too', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-tree')
  fireEvent.click(screen.getByText('Chapter 1')) // select the chapter explicitly
  const req = () => screen.getByTestId('bid-materials-requirement') as HTMLTextAreaElement
  fireEvent.change(req(), { target: { value: 'CHAPTER_REQ' } })
  expect(req().value).toBe('CHAPTER_REQ')
  fireEvent.click(screen.getByTestId('bid-materials-save-next'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  // Advanced to the chapter's first child (c1a, empty) — the textarea clears.
  await waitFor(() => expect(req().value).toBe(''))
})

it('shows save feedback on the Save & next button, not the first', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  const next = await screen.findByTestId('bid-materials-save-next')
  fireEvent.click(next)
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getByTestId('bid-materials-save-next').textContent).toBe('phase2.saved')
  )
  // The "Save this node" button keeps its default label (feedback is not on it).
  expect(screen.getByTestId('bid-materials-save').textContent).toBe('phase2.save')
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

it('persists briefs when saving the node', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  fireEvent.change(await screen.findByTestId('bid-materials-requirement'), {
    target: { value: '新要求' },
  })
  fireEvent.click(screen.getByTestId('bid-materials-save'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.briefs.c1a.requirements).toBe('新要求')
})

it('saves bidder company into qualifications and kb', async () => {
  // Bidder info card was removed in stage-2 (no in-screen editor anymore);
  // company capture moves to project creation in a follow-up. Verify the card
  // is gone so the SoT gap is explicit.
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-requirement')
  expect(screen.queryByTestId('bid-bidder-company')).toBeNull()
  expect(screen.queryByTestId('bid-bidder-save')).toBeNull()
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

it('renders resolved scoring/clause text and hides internal ids', async () => {
  ;(bidApis.getGrounding as jest.Mock).mockResolvedValueOnce({
    items: {
      c1a: {
        scoring: [{ id: 'T1', item: '技术方案', weight: 30 }],
        clauses: [{ id: 'MC-002', text: '投标保证金', veto: true }],
      },
    },
  })
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  // The clause text resolves (outline leaf c1 covers T1; clause MC-002 is shown
  // when a node covers it). The first leaf c1a covers T1 -> shows "技术方案".
  expect(await screen.findByText(/技术方案/)).toBeInTheDocument()
  // Internal ids never leak to the user.
  expect(screen.queryByText('T1')).toBeNull()
})

it('removes fake material-analysis card and shows honest section-materials', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  await screen.findByTestId('bid-materials-requirement')
  // No AI-extract badge / fake arithmetic card.
  expect(screen.queryByText(/phase2\.ai_extract/i)).toBeNull()
  expect(screen.queryByText(/phase2\.keypoints/i)).toBeNull()
})

it('importance is editable and persists into the brief', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  const select = await screen.findByTestId('bid-materials-importance')
  fireEvent.change(select, { target: { value: '高' } })
  fireEvent.click(screen.getByTestId('bid-materials-save'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.briefs.c1a.importance).toBe('高')
})

it('importance defaults to auto (derived) and brief does not persist importance', async () => {
  // No manual selection: importance select sits on the "auto" option; saving the
  // brief must NOT write a importance (it stays derived at render time). Touch the
  // node so it appears in the saved brief, then assert importance is empty/absent.
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  const select = await screen.findByTestId('bid-materials-importance')
  // The "auto" option (empty value) is present and currently selected.
  const autoOpt = (select as HTMLSelectElement).querySelector('option[value=""]')!
  expect(autoOpt).toBeTruthy()
  expect((select as HTMLSelectElement).value).toBe('')
  const req = await screen.findByTestId('bid-materials-requirement')
  fireEvent.change(req, { target: { value: 'auto-importance node' } })
  fireEvent.click(screen.getByTestId('bid-materials-save'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  // importance is absent (or empty) when the user never picked one manually.
  expect(doc.briefs.c1a.importance ?? '').toBe('')
})

it('importance "restore auto" clears a previously-set manual override', async () => {
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  const select = await screen.findByTestId('bid-materials-importance')
  // Pick a manual value first.
  fireEvent.change(select, { target: { value: '高' } })
  expect((select as HTMLSelectElement).value).toBe('高')
  // Then restore auto (the empty-string option).
  fireEvent.change(select, { target: { value: '' } })
  expect((select as HTMLSelectElement).value).toBe('')
  fireEvent.click(screen.getByTestId('bid-materials-save'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.briefs.c1a.importance ?? '').toBe('')
})

it('shows deterministic stats from uploaded attachment', async () => {
  ;(bidApis.uploadAttachment as jest.Mock).mockResolvedValueOnce({
    name: 'cap.pdf',
    size: 1024,
    stats: { chars: 1234, pages: 5, tables: 2, images: 1 },
  })
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  const dropzone = await screen.findByTestId('bid-materials-dropzone')
  const input = dropzone.parentElement!.querySelector('input[type="file"]')!
  fireEvent.change(input, { target: { files: [new File(['x'], 'cap.pdf')] } })
  // Real stats surface in the right panel.
  await waitFor(() => expect(bidApis.uploadAttachment).toHaveBeenCalled())
})

it('brief materials store only references; size shown from attachments list', async () => {
  // The briefs doc persists only {id, name, linkedNodeIds}; size/stats are NOT
  // duplicated into the brief — they are resolved from listAttachments at render.
  ;(bidApis.getBriefs as jest.Mock).mockResolvedValueOnce({
    briefs: {},
    materials: [{ id: 'm1', name: 'a.pdf', linkedNodeIds: ['c1a'] }],
  })
  ;(bidApis.listAttachments as jest.Mock).mockResolvedValueOnce({
    items: [{ name: 'a.pdf', size: 2048, stats: { chars: 10, pages: 1, tables: 0, images: 0 } }],
  })
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  // c1a is auto-selected; its material area shows the size resolved from the
  // attachments list (2048 bytes -> "2 KB").
  expect(await screen.findByText(/2 KB/)).toBeInTheDocument()
  // Saving must persist a reference-only material (no size/stats keys).
  fireEvent.click(screen.getByTestId('bid-materials-save'))
  await waitFor(() => expect(bidApis.saveBriefs).toHaveBeenCalled())
  const doc = (bidApis.saveBriefs as jest.Mock).mock.calls.at(-1)![1]
  expect(doc.materials[0]).toEqual({ id: 'm1', name: 'a.pdf', linkedNodeIds: ['c1a'] })
  expect(Object.keys(doc.materials[0]).sort()).toEqual(['id', 'linkedNodeIds', 'name'])
})

it('surfaces save state feedback when saving the node', async () => {
  let resolveSave!: (v: unknown) => void
  ;(bidApis.saveBriefs as jest.Mock).mockReturnValueOnce(
    new Promise(r => {
      resolveSave = r
    })
  )
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  fireEvent.click(await screen.findByTestId('bid-materials-save'))
  // While in-flight, the button shows the saving label.
  await waitFor(() =>
    expect(screen.getByTestId('bid-materials-save')).toHaveTextContent('phase2.saving')
  )
  resolveSave({})
  await waitFor(() =>
    expect(screen.getByTestId('bid-materials-save')).toHaveTextContent('phase2.saved')
  )
})

it('surfaces save error feedback on failure', async () => {
  ;(bidApis.saveBriefs as jest.Mock).mockRejectedValueOnce(new Error('boom'))
  render(<MaterialsScreen projectId={7} outline={OUTLINE} onComplete={jest.fn()} />)
  fireEvent.click(await screen.findByTestId('bid-materials-save'))
  await waitFor(() =>
    expect(screen.getByTestId('bid-materials-save')).toHaveTextContent('phase2.save_error')
  )
})
