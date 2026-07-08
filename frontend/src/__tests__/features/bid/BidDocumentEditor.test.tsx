// SPDX-License-Identifier: Apache-2.0
import { render, screen, act, waitFor } from '@testing-library/react'
import { BidDocumentEditor } from '@/features/bid/components/BidDocumentEditor'
import { bidApis } from '@/apis/bid'
import { __lastEditorConfig, __mockEditor } from '@/__mocks__/@tiptap__react'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  __lastEditorConfig.current = null
  __mockEditor.__chainCalls = []
  __mockEditor.__events = {}
  ;(bidApis.saveSection as jest.Mock).mockResolvedValue({ version: 'v2' })
})

const mkSections = () => [
  {
    id: 's1',
    content: '# 一、方案\n\n第一段。\n\n第二段。',
    version: 'v1',
    status: 'done' as const,
    accepted: false,
  },
  {
    id: 's2',
    content: '# 二、保障\n\n保障正文。',
    version: 'v1b',
    status: 'done' as const,
    accepted: false,
  },
]

test('mounts a single-document editor surface', () => {
  render(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      onSaved={jest.fn()}
    />
  )
  expect(screen.getByTestId('bid-document-editor')).toBeInTheDocument()
  expect(__lastEditorConfig.current?.editable).toBe(true)
})

test('flushSection persists a section via the per-section CAS save', async () => {
  // Task 5 covers the per-section CAS + bidSeed guard in depth; here we verify
  // the editor WIRES flushSection through to bidApis.saveSection.
  jest.useFakeTimers()
  const onSaved = jest.fn()
  let api: { flushSection: (sid: string) => Promise<string> } | undefined
  render(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      onSaved={onSaved}
      onReady={a => {
        api = a
      }}
    />
  )
  // Make section s1 appear dirty to the autosave baseline so flush persists it.
  __mockEditor.state.doc.forEach = jest.fn((cb: (node: unknown, _o: number, i: number) => void) => {
    cb({ type: { name: 'bidSection' }, attrs: { sectionId: 's1', version: 'v1' } }, 0, 0)
  })
  __mockEditor.storage.markdown.serializer = {
    serialize: () => 'EDITED body',
  }
  await act(async () => {
    await api!.flushSection('s1')
    await Promise.resolve()
  })
  await waitFor(() =>
    expect(bidApis.saveSection).toHaveBeenCalledWith(1, 's1', 'EDITED body', 'v1')
  )
  jest.useRealTimers()
})

test('shows the block handle + block-insert menu (no legacy toolbar)', () => {
  render(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      onSaved={jest.fn()}
    />
  )
  // The old Table/Divider toolbar is gone (subproject 🅐 replaced it).
  expect(screen.queryByTestId('bid-editor-toolbar')).not.toBeInTheDocument()
  // The block handle now hosts the `+` insert trigger.
  expect(screen.getByTestId('bid-drag-handle-inner')).toBeInTheDocument()
  expect(screen.getByTestId('bid-block-insert-trigger')).toBeInTheDocument()
})

test('reports the unfilled placeholder count from the document (🅓)', () => {
  __mockEditor.state.doc.descendants = (cb: (n: unknown) => void) => {
    cb({ type: { name: 'bidPlaceholder' } })
    cb({ type: { name: 'paragraph' } })
    cb({ type: { name: 'bidPlaceholder' } })
  }
  const onCount = jest.fn()
  render(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      onSaved={jest.fn()}
      onPlaceholderCountChange={onCount}
    />
  )
  expect(onCount).toHaveBeenCalledWith(2)
  delete (__mockEditor.state.doc as { descendants?: unknown }).descendants
})

test('always renders editing affordances without a mode toggle', () => {
  // PR-C drops the read/edit mode: the editor is always editable, so the
  // selection bubble, drag handle, block-insert trigger, and table controls
  // are always mounted — with no `bid-mode-toggle` to flip first.
  render(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      onSaved={jest.fn()}
    />
  )
  expect(screen.queryByTestId('bid-mode-toggle')).toBeNull()
  expect(screen.getByTestId('bid-bubble-toolbar')).toBeInTheDocument()
  expect(screen.getByTestId('bid-drag-handle-inner')).toBeInTheDocument()
  expect(screen.getByTestId('bid-block-insert-trigger')).toBeInTheDocument()
  // The editor itself is editable from the first render.
  expect(__lastEditorConfig.current?.editable).toBe(true)
})

test('exposes its editor + per-section flush to the parent via onReady', () => {
  const onReady = jest.fn()
  render(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      onSaved={jest.fn()}
      onReady={onReady}
    />
  )
  expect(onReady).toHaveBeenCalledWith(
    expect.objectContaining({
      editor: expect.anything(),
      flushSection: expect.any(Function),
    })
  )
})
