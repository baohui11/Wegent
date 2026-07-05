// SPDX-License-Identifier: Apache-2.0
// Shared Jest mock for @tiptap/react. ProseMirror cannot run under jsdom in our
// test setup (Schema/Selection rely on real DOM layout), so every test that
// transitively renders SectionEditor needs useEditor stubbed. Mapped globally
// via jest.config.ts moduleNameMapper so individual test files don't each have
// to declare it.
//
// Tests can drive the editor by mutating `__mockEditor` (the current instance)
// — e.g. set `__mockEditor.storage.markdown.getMarkdown` to a fixture string,
// or `__mockEditor.state.selection.$from.index` to a top-level block index —
// then fire `__lastEditorConfig.current.onUpdate(...)`.
import React from 'react'

interface EditorConfig {
  editable?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate?: (props: { editor: any }) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export const __lastEditorConfig: { current: EditorConfig | null } = { current: null }

// The single mock editor instance tests can mutate to drive behavior.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const __mockEditor: any = {
  isEditable: true,
  setEditable: jest.fn(),
  commands: { setContent: jest.fn() },
  storage: { markdown: { getMarkdown: () => '' } },
  on: jest.fn(),
  off: jest.fn(),
  destroy: jest.fn(),
  state: { selection: { $from: { index: (depth: number) => (depth === 0 ? 0 : 0) } } },
  // chain() records command names so insert-toolbar tests can assert calls.
  // All chain() invocations share one persistent __chainCalls log; each method
  // access returns a callable that records its name and returns the builder.
  __chainCalls: [] as string[],
  chain: function () {
    const calls = __mockEditor.__chainCalls as string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = new Proxy(
      function () {
        return builder
      },
      {
        get(_t, prop: string) {
          if (prop === 'run') return () => true
          // Every other method: record the name and stay chainable. Calling
          // it (with any args) also returns builder.
          calls.push(prop)
          return (..._args: unknown[]) => builder
        },
      }
    )
    return builder
  },
}

export function useEditor(config: EditorConfig) {
  __lastEditorConfig.current = config
  return __mockEditor
}

export function EditorContent() {
  return React.createElement('div', { 'data-testid': 'bid-section-editor' })
}

export default { useEditor, EditorContent, __mockEditor, __lastEditorConfig }
