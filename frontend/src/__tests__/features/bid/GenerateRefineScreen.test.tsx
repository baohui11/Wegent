// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { GenerateRefineScreen } from '@/features/bid/components/GenerateRefineScreen'
import { bidApis } from '@/apis/bid'
// @tiptap/react + tiptap-markdown + extension packages are mocked globally via
// jest.config.ts moduleNameMapper. The shared mock exposes the last editor
// config on __lastEditorConfig and the mock editor on __mockEditor so a test
// can drive the autosave / redraft-range paths.
import { __lastEditorConfig, __mockEditor } from '@/__mocks__/@tiptap__react'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const OUTLINE = {
  sections: [
    { id: 'c1', title: '一、方案', children: [{ id: 's1', title: '1. 子节' }] },
    { id: 'c2', title: '二、保障', children: [{ id: 's2', title: '2.1' }] },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  __lastEditorConfig.current = null
  __mockEditor.__events = {}
  __mockEditor.__chainCalls = []
  ;(bidApis.getReviewStatus as jest.Mock).mockResolvedValue({ accepted: {} })
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({
    content: '正文段落。',
    version: 'v1',
  })
  ;(bidApis.redraftSection as jest.Mock).mockResolvedValue({})
  ;(bidApis.redraftRange as jest.Mock).mockResolvedValue({ status: 'drafting' })
  ;(bidApis.acceptSection as jest.Mock).mockResolvedValue({})
  ;(bidApis.saveSection as jest.Mock).mockResolvedValue({ version: 'v2' })
})

test('renders the single-document surface for done sections', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 2,
    finished: false,
    error: null,
    sections: { s1: 'done', s2: 'done' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  expect(await screen.findByTestId('bid-generate-document')).toBeInTheDocument()
  // Single-document editor is always mounted (read mode by default); each done
  // section is a bidSection node inside it (not a separate SectionEditor).
  expect(screen.getByTestId('bid-document-editor')).toBeInTheDocument()
  expect(screen.getByTestId('bid-draft-progress').textContent).toContain('2/2')
})

test('read mode is the default; the document editor stays read-only until toggled', async () => {
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    finished: true,
    error: null,
    sections: { s1: 'done' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  await screen.findByTestId('bid-document-editor')
  // The single-document editor is mounted in read mode.
  expect(__lastEditorConfig.current?.editable).toBe(false)
  // Toggling to edit makes the whole document editable.
  fireEvent.click(screen.getByTestId('bid-mode-toggle'))
  expect(__mockEditor.setEditable).toHaveBeenLastCalledWith(true)
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

test('regenerate-this-block maps a section-local block to a body-relative line range', async () => {
  // Title-less body has two top-level paragraphs: '第一段。' / '第二段。'.
  // blockLineRange('第一段。\n\n第二段。', 1) -> {3,3} (relative to the BODY,
  // which is what the backend stores now — reviewer constraint #4). The line
  // range is the test's core assertion; the flush-then-base_version path is
  // covered by the document autosave hook tests (Task 5).
  ;(bidApis.getSectionContent as jest.Mock).mockResolvedValue({
    id: 's1',
    content: '第一段。\n\n第二段。',
    version: 'v1',
  })
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    finished: true,
    error: null,
    sections: { s1: 'done' },
  })
  // Cursor sits in section s1's 2nd top-level block (section-local index 1).
  // The mock doc must expose the s1 bidSection node (forEach) so regenBlock's
  // findSectionNode + topBlockIndexOf can both locate it.
  __mockEditor.state.doc.forEach = (cb: (node: unknown, _o: number, _i: number) => void) => {
    cb({ type: { name: 'bidSection' }, attrs: { sectionId: 's1' } }, 0, 0)
  }
  __mockEditor.storage.markdown.serializer = {
    serialize: () => '第一段。\n\n第二段。',
  }
  __mockEditor.state.selection.$from = {
    depth: 2,
    node: (d: number) =>
      d === 1
        ? { type: { name: 'bidSection' }, attrs: { sectionId: 's1' } }
        : { type: { name: 'paragraph' } },
    index: (d: number) => (d === 1 ? 1 : 0),
  }

  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  await screen.findByTestId('bid-document-editor')
  fireEvent.click(screen.getByTestId('bid-mode-toggle'))
  fireEvent.click(await screen.findByTestId('bid-regen-block-button'))
  // The line range is the contract: section-local block index 1 maps to lines
  // 3..3 of the title-less body. base_version is the focused section's version.
  await waitFor(() =>
    expect(bidApis.redraftRange).toHaveBeenCalledWith(1, 's1', 3, 3, undefined, expect.any(String))
  )
})

test('entering edit mode does NOT autosave every section (mount-time PUT guard)', async () => {
  // Regression guard: the population setContent is stamped bidSeed, so loading
  // the document must NOT PUT. saveSection should only fire on a genuine edit.
  jest.useFakeTimers()
  ;(bidApis.getDraftStatus as jest.Mock).mockResolvedValue({
    total: 1,
    finished: true,
    error: null,
    sections: { s1: 'done' },
  })
  render(<GenerateRefineScreen projectId={1} outline={OUTLINE as never} />)
  await screen.findByTestId('bid-document-editor')
  // Toggle to edit (mounts population) and advance past the debounce: no save.
  fireEvent.click(screen.getByTestId('bid-mode-toggle'))
  act(() => jest.advanceTimersByTime(1600))
  expect(bidApis.saveSection).not.toHaveBeenCalled()
  jest.useRealTimers()
})
