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
      mode="edit"
      onSaved={jest.fn()}
    />
  )
  expect(screen.getByTestId('bid-document-editor')).toBeInTheDocument()
  expect(__lastEditorConfig.current?.editable).toBe(true)
})

test('edit mode flips editable; read mode is non-editable', () => {
  const { rerender } = render(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      mode="read"
      onSaved={jest.fn()}
    />
  )
  expect(__lastEditorConfig.current?.editable).toBe(false)
  rerender(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      mode="edit"
      onSaved={jest.fn()}
    />
  )
  expect(__mockEditor.setEditable).toHaveBeenCalledWith(true)
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
      mode="edit"
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

test('exposes its editor + per-section flush to the parent via onReady', () => {
  const onReady = jest.fn()
  render(
    <BidDocumentEditor
      projectId={1}
      sections={mkSections()}
      sectionNames={{ s1: '一、方案', s2: '二、保障' }}
      mode="read"
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
