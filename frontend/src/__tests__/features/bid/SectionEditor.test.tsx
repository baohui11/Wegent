// SPDX-License-Identifier: Apache-2.0
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { SectionEditor } from '@/features/bid/components/SectionEditor'
import { bidApis } from '@/apis/bid'
// @tiptap/react + tiptap-markdown + the extension packages are mocked globally
// via jest.config.ts moduleNameMapper (ProseMirror can't run under jsdom). The
// shared @tiptap/react mock exposes the last editor config on __lastEditorConfig
// and the editor instance on __mockEditor (its chain() records command names).
import { __lastEditorConfig, __mockEditor } from '@/__mocks__/@tiptap__react'

jest.mock('@/apis/bid')

beforeEach(() => {
  jest.clearAllMocks()
  __lastEditorConfig.current = null
  ;(bidApis.saveSection as jest.Mock).mockResolvedValue({ version: 'v2' })
})

test('SectionEditor renders an editor surface and seeds content', () => {
  render(
    <SectionEditor
      projectId={1}
      sectionId="s1"
      content="# hello"
      version="v1"
      readOnly={false}
      onSaved={() => {}}
    />
  )
  expect(screen.getByTestId('bid-section-editor')).toBeInTheDocument()
  expect(__lastEditorConfig.current?.content).toBe('# hello')
})

test('SectionEditor passes readOnly to editable=false', () => {
  render(
    <SectionEditor
      projectId={1}
      sectionId="s1"
      content="x"
      version="v1"
      readOnly
      onSaved={() => {}}
    />
  )
  expect(__lastEditorConfig.current?.editable).toBe(false)
})

test('insert toolbar triggers table and horizontal-rule commands when editable', () => {
  __mockEditor.__chainCalls = []
  render(
    <SectionEditor
      projectId={1}
      sectionId="s1"
      content="x"
      version="v1"
      readOnly={false}
      onSaved={() => {}}
    />
  )
  fireEvent.click(screen.getByTestId('bid-insert-table-button'))
  fireEvent.click(screen.getByTestId('bid-insert-pagebreak-button'))
  const calls = __mockEditor.__chainCalls as string[]
  expect(calls).toContain('insertTable')
  expect(calls).toContain('setHorizontalRule')
})

test('SectionEditor autosaves its own section on edit', async () => {
  jest.useFakeTimers()
  render(
    <SectionEditor
      projectId={1}
      sectionId="s1"
      content="x"
      version="v1"
      readOnly={false}
      onSaved={() => {}}
    />
  )
  // A genuine edit is focus-then-type: onFocus arms autosave, onUpdate queues.
  act(() => __lastEditorConfig.current?.onFocus?.())
  act(() =>
    __lastEditorConfig.current?.onUpdate?.({
      editor: { storage: { markdown: { getMarkdown: () => '改' } } },
    })
  )
  act(() => jest.advanceTimersByTime(1600))
  await waitFor(() => expect(bidApis.saveSection).toHaveBeenCalledWith(1, 's1', '改', 'v1'))
  jest.useRealTimers()
})

test('SectionEditor does NOT autosave on mount/re-seed (no user focus)', async () => {
  // Regression guard: tiptap-markdown re-normalizes content on mount and emits
  // an update; without a prior focus this must NOT persist (else entering Edit
  // mode would PUT every section and clear its accepted flag).
  jest.useFakeTimers()
  render(
    <SectionEditor
      projectId={1}
      sectionId="s1"
      content="x"
      version="v1"
      readOnly={false}
      onSaved={() => {}}
    />
  )
  // onUpdate fires without any focus (mimics the on-mount normalization emit).
  act(() =>
    __lastEditorConfig.current?.onUpdate?.({
      editor: { storage: { markdown: { getMarkdown: () => 'normalized' } } },
    })
  )
  act(() => jest.advanceTimersByTime(1600))
  expect(bidApis.saveSection).not.toHaveBeenCalled()
  jest.useRealTimers()
})

test('SectionEditor reports focus and exposes its editor/flush via onReady', () => {
  const onFocus = jest.fn()
  const onReady = jest.fn()
  render(
    <SectionEditor
      projectId={1}
      sectionId="s1"
      content="x"
      version="v1"
      readOnly={false}
      onSaved={() => {}}
      onFocus={onFocus}
      onReady={onReady}
    />
  )
  // onFocus wired into useEditor config
  expect(typeof __lastEditorConfig.current?.onFocus).toBe('function')
  act(() => __lastEditorConfig.current?.onFocus?.())
  expect(onFocus).toHaveBeenCalledWith('s1')
  // onReady fires with { editor, flush }
  expect(onReady).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({ flush: expect.any(Function) })
  )
})

test('editable SectionEditor renders a drag handle; read-only does not', () => {
  const { rerender } = render(
    <SectionEditor
      projectId={1}
      sectionId="s1"
      content="x"
      version="v1"
      readOnly={false}
      onSaved={() => {}}
    />
  )
  expect(screen.getByTestId('bid-drag-handle')).toBeInTheDocument()
  rerender(
    <SectionEditor
      projectId={1}
      sectionId="s1"
      content="x"
      version="v1"
      readOnly
      onSaved={() => {}}
    />
  )
  expect(screen.queryByTestId('bid-drag-handle')).not.toBeInTheDocument()
})
