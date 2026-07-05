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
}

export function useEditor(config: EditorConfig) {
  __lastEditorConfig.current = config
  return __mockEditor
}

export function EditorContent() {
  return React.createElement('div', { 'data-testid': 'bid-section-editor' })
}

export default { useEditor, EditorContent, __mockEditor, __lastEditorConfig }
