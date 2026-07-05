// SPDX-License-Identifier: Apache-2.0
import { render, screen, fireEvent } from '@testing-library/react'
import { SectionBubbleMenu } from '@/features/bid/components/SectionBubbleMenu'

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// Build a fake editor whose chain() records command names so we can assert the
// bubble buttons dispatch the right formatting commands.
function makeEditor(calls: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  chain.focus = () => chain
  chain.toggleBold = () => {
    calls.push('bold')
    return chain
  }
  chain.toggleItalic = () => {
    calls.push('italic')
    return chain
  }
  chain.toggleCode = () => {
    calls.push('code')
    return chain
  }
  chain.toggleHeading = () => {
    calls.push('heading')
    return chain
  }
  chain.toggleBulletList = () => {
    calls.push('bullet')
    return chain
  }
  chain.toggleOrderedList = () => {
    calls.push('ordered')
    return chain
  }
  chain.run = () => true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { chain: () => chain, isActive: () => false } as any
}

test('bubble menu buttons trigger formatting commands', () => {
  const calls: string[] = []
  render(<SectionBubbleMenu editor={makeEditor(calls)} />)
  fireEvent.click(screen.getByTestId('bid-bubble-bold'))
  fireEvent.click(screen.getByTestId('bid-bubble-italic'))
  fireEvent.click(screen.getByTestId('bid-bubble-code'))
  fireEvent.click(screen.getByTestId('bid-bubble-h2'))
  fireEvent.click(screen.getByTestId('bid-bubble-bullet'))
  fireEvent.click(screen.getByTestId('bid-bubble-ordered'))
  expect(calls).toEqual(['bold', 'italic', 'code', 'heading', 'bullet', 'ordered'])
})

test('bubble menu renders nothing without an editor', () => {
  const { container } = render(<SectionBubbleMenu editor={null} />)
  expect(container).toBeEmptyDOMElement()
})
