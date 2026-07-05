// SPDX-License-Identifier: Apache-2.0
// Mock @tiptap/extension-drag-handle-react — jsdom can't run the real drag
// handle (needs ProseMirror layout + DOM positioning). The real component
// renders its children as the handle; this mock renders them inside a stable
// testid wrapper so presence/disappearance (editable vs read-only) is testable.
import type { ReactNode } from 'react'

interface DragHandleProps {
  children?: ReactNode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor?: any
  nested?: boolean
}

export default function DragHandle({ children }: DragHandleProps) {
  return <div data-testid="bid-drag-handle">{children}</div>
}
