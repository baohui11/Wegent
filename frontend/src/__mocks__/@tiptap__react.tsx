// SPDX-License-Identifier: Apache-2.0
// Shared Jest mock for @tiptap/react. ProseMirror cannot run under jsdom in our
// test setup (Schema/Selection rely on real DOM layout), so every test that
// transitively renders SectionEditor needs useEditor stubbed. Mapped globally
// via jest.config.ts moduleNameMapper so individual test files don't each have
// to declare it.
//
// Tests that need to drive the editor (e.g. autosave) read the last config off
// the module export `__lastEditorConfig` and fire its onUpdate.
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

export function useEditor(config: EditorConfig) {
  __lastEditorConfig.current = config
  return {
    isEditable: config.editable !== false,
    setEditable: jest.fn(),
    commands: { setContent: jest.fn() },
    storage: { markdown: { getMarkdown: () => '' } },
    on: jest.fn(),
    off: jest.fn(),
    destroy: jest.fn(),
  }
}

export function EditorContent() {
  return React.createElement('div', { 'data-testid': 'bid-section-editor' })
}

export default { useEditor, EditorContent }
