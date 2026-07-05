// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react'
import { SectionEditor } from '@/features/bid/components/SectionEditor'
// @tiptap/react + tiptap-markdown + the extension packages are mocked globally
// via jest.config.ts moduleNameMapper (ProseMirror can't run under jsdom). The
// shared @tiptap/react mock exposes the last editor config on __lastEditorConfig.
import { __lastEditorConfig } from '@tiptap/react'

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
