// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react'
import { BidSectionNodeView } from '@/features/bid/components/BidSectionNodeView'

// @tiptap/react's NodeView* primitives are plain passthrough wrappers in the
// Jest mock (they render a div + their content slot). So we can render the
// NodeView component directly with a hand-built { node, extension } and assert
// the chrome contract: outline title rendered ONCE, status pill for non-done
// sections, and the drafting lock flipping contentEditable to false.

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const view = (attrs: Record<string, unknown>, names: Record<string, string> = {}) =>
  render(
    <BidSectionNodeView
      node={{ attrs } as never}
      extension={{ options: { sectionNames: names } } as never}
    />
  )

describe('BidSectionNodeView', () => {
  test('renders the outline title once (from sectionNames option)', () => {
    view({ sectionId: 's1', status: 'done', accepted: false }, { s1: '第一章 总体技术方案' })
    const chrome = screen.getByTestId('bid-section-s1')
    expect(chrome).toHaveTextContent('第一章 总体技术方案')
    // The title appears exactly once in the chrome.
    expect((chrome.textContent ?? '').match(/第一章 总体技术方案/g)?.length).toBe(1)
  })

  test('falls back to the sectionId when the outline name is missing', () => {
    view({ sectionId: 's9', status: 'done', accepted: false }, {})
    expect(screen.getByTestId('bid-section-s9')).toHaveTextContent('s9')
  })

  test('shows a status pill for non-done sections; no pill when done', () => {
    view({ sectionId: 's1', status: 'drafting', accepted: false }, { s1: 'T' })
    expect(screen.getByTestId('bid-section-status-s1')).toHaveTextContent('phase4.status_drafting')

    const { unmount } = view({ sectionId: 's2', status: 'done', accepted: false }, { s2: 'T' })
    expect(screen.queryByTestId('bid-section-status-s2')).not.toBeInTheDocument()
    unmount()
  })

  test('locks the body (contentEditable=false) while drafting; editable otherwise', () => {
    const { rerender } = view({ sectionId: 's1', status: 'drafting', accepted: false }, { s1: 'T' })
    expect(screen.getByTestId('bid-section-content-s1')).toHaveAttribute('contenteditable', 'false')

    rerender(
      <BidSectionNodeView
        node={{ attrs: { sectionId: 's1', status: 'done', accepted: false } } as never}
        extension={{ options: { sectionNames: { s1: 'T' } } } as never}
      />
    )
    expect(screen.getByTestId('bid-section-content-s1')).toHaveAttribute('contenteditable', 'true')
  })

  test('shows the accepted check when accepted=true', () => {
    view({ sectionId: 's1', status: 'done', accepted: true }, { s1: 'T' })
    expect(screen.getByLabelText('accepted')).toBeInTheDocument()
  })
})
