// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react'
import { SectionEditor } from '@/features/bid/components/SectionEditor'

// Mock @tiptap/react to a controllable stub that exposes the editor config so
// we can assert wiring (content seed + editable flag) without spinning up a
// real ProseMirror instance in jsdom.
let lastConfig: {
  content: string
  editable: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate?: (props: { editor: any }) => void
} | null = null
jest.mock('@tiptap/react', () => ({
  useEditor: (config: typeof lastConfig) => {
    lastConfig = config
    return {
      isEditable: config.editable !== false,
      setEditable: jest.fn(),
      commands: { setContent: jest.fn() },
      storage: { markdown: { getMarkdown: () => '# edited' } },
      on: jest.fn(),
      off: jest.fn(),
      destroy: jest.fn(),
    }
  },
  EditorContent: () => <div data-testid="bid-section-editor" />,
}))
// tiptap-markdown is mapped to a stub via jest.config.ts moduleNameMapper.

beforeEach(() => {
  lastConfig = null
})

test('SectionEditor renders an editor surface and seeds content', () => {
  render(<SectionEditor content="# hello" readOnly={false} onChange={() => {}} />)
  expect(screen.getByTestId('bid-section-editor')).toBeInTheDocument()
  expect(lastConfig?.content).toBe('# hello')
})

test('SectionEditor passes readOnly to editable=false', () => {
  render(<SectionEditor content="x" readOnly onChange={() => {}} />)
  expect(lastConfig?.editable).toBe(false)
})
