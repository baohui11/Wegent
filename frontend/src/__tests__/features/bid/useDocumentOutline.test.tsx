// SPDX-License-Identifier: Apache-2.0
import { renderHook, act } from '@testing-library/react'
import { useDocumentOutline } from '@/features/bid/hooks/useDocumentOutline'

// Fake ProseMirror nodes (same contract deriveOutline uses) + a mock editor that
// lets a test fire update/selectionUpdate and move the caret.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function heading(level: number, text: string): any {
  return {
    type: { name: 'heading' },
    attrs: { level },
    textContent: text,
    nodeSize: text.length + 2,
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function section(sectionId: string, children: any[]): any {
  return {
    type: { name: 'bidSection' },
    attrs: { sectionId },
    nodeSize: children.reduce((s, c) => s + c.nodeSize, 0) + 2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forEach(fn: (c: any) => void) {
      children.forEach(fn)
    },
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockEditor(sections: any[]) {
  const handlers: Record<string, Array<() => void>> = {}
  const editor = {
    state: {
       
      doc: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        forEach(fn: (n: any, offset: number) => void) {
          let offset = 0
          sections.forEach(s => {
            fn(s, offset)
            offset += s.nodeSize
          })
        },
      },
      selection: { $from: { pos: 0 } },
    },
    on(ev: string, cb: () => void) {
      ;(handlers[ev] ||= []).push(cb)
    },
    off(ev: string, cb: () => void) {
      handlers[ev] = (handlers[ev] || []).filter(h => h !== cb)
    },
    view: { domAtPos: () => ({ node: document.createElement('div') }) },
  }
  const fire = (ev: string) => (handlers[ev] || []).forEach(h => h())
  const setCaret = (pos: number) => {
    editor.state.selection = { $from: { pos } }
  }
  return { editor, fire, setCaret }
}

const NAMES = { s1: '第一章', s2: '第二章' }

test('derives entries and tracks the active entry by caret', () => {
  // s1 (pos 0) with one heading (pos 1); s2 (pos 6, = s1.nodeSize).
  const { editor, fire, setCaret } = makeMockEditor([
    section('s1', [heading(2, '架构')]),
    section('s2', []),
  ])
  const { result } = renderHook(() => useDocumentOutline(editor as never, NAMES))
  expect(result.current.entries.map(e => e.key)).toEqual(['s1', 's1#1', 's2'])
  // Caret starts at 0 → first section is active.
  expect(result.current.activeKey).toBe('s1')
  // Move the caret into s2 and fire a selection update.
  act(() => {
    setCaret(6)
    fire('selectionUpdate')
  })
  expect(result.current.activeKey).toBe('s2')
})

test('recomputes entries when the document updates', () => {
  const start = makeMockEditor([section('s1', [])])
  const { result } = renderHook(() => useDocumentOutline(start.editor as never, NAMES))
  expect(result.current.entries).toHaveLength(1)
  // Add a heading to s1's body, then fire update.
  start.editor.state.doc = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forEach(fn: (n: any, offset: number) => void) {
      fn(section('s1', [heading(2, '新标题')]), 0)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  act(() => start.fire('update'))
  expect(result.current.entries.map(e => e.kind)).toEqual(['section', 'heading'])
})

test('scrollTo a section targets its [data-bid-section] anchor', () => {
  const { editor } = makeMockEditor([section('s1', [])])
  const { result } = renderHook(() => useDocumentOutline(editor as never, NAMES))
  const scrollIntoView = jest.fn()
  const qs = jest.spyOn(document, 'querySelector').mockReturnValue({ scrollIntoView } as never)
  act(() => result.current.scrollTo(result.current.entries[0]))
  expect(qs).toHaveBeenCalledWith('[data-bid-section="s1"]')
  expect(scrollIntoView).toHaveBeenCalled()
  qs.mockRestore()
})
