// SPDX-License-Identifier: Apache-2.0
// Mock @tiptap/react/menus — floating-ui positioning doesn't run under jsdom,
// so BubbleMenu/FloatingMenu are stubbed to plain wrappers around their
// children. The real BubbleMenu reads `editor` to decide when to show; this
// mock always renders its children so button presence/command tests work.
import type { ReactNode } from 'react'

interface MenuProps {
  children?: ReactNode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export function BubbleMenu({ children }: MenuProps) {
  return <div data-testid="bid-bubble-menu">{children}</div>
}

export function FloatingMenu({ children }: MenuProps) {
  return <div>{children}</div>
}
