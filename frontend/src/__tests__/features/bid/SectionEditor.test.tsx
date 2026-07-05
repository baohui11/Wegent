// SPDX-License-Identifier: Apache-2.0
import { render, screen, fireEvent } from '@testing-library/react'
import { SectionEditor } from '@/features/bid/components/SectionEditor'
// @tiptap/react + tiptap-markdown + the extension packages are mocked globally
// via jest.config.ts moduleNameMapper (ProseMirror can't run under jsdom). The
// shared @tiptap/react mock exposes the last editor config on __lastEditorConfig
// and the editor instance on __mockEditor (its chain() records command names).
import { __lastEditorConfig, __mockEditor } from '@/__mocks__/@tiptap__react'

beforeEach(() => {
  __lastEditorConfig.current = null
})

test('SectionEditor renders an editor surface and seeds content', () => {
  render(<SectionEditor content="# hello" readOnly={false} onChange={() => {}} />)
  expect(screen.getByTestId('bid-section-editor')).toBeInTheDocument()
  expect(__lastEditorConfig.current?.content).toBe('# hello')
})

test('SectionEditor passes readOnly to editable=false', () => {
  render(<SectionEditor content="x" readOnly onChange={() => {}} />)
  expect(__lastEditorConfig.current?.editable).toBe(false)
})

test('insert toolbar triggers table and horizontal-rule commands when editable', () => {
  __mockEditor.__chainCalls = []
  render(<SectionEditor content="x" readOnly={false} onChange={() => {}} />)
  fireEvent.click(screen.getByTestId('bid-insert-table-button'))
  fireEvent.click(screen.getByTestId('bid-insert-pagebreak-button'))
  const calls = __mockEditor.__chainCalls as string[]
  expect(calls).toContain('insertTable')
  expect(calls).toContain('setHorizontalRule')
})
