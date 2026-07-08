// SPDX-License-Identifier: Apache-2.0
'use client'

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { chipLabel } from '../canvas/placeholders'

// Renders one placeholder as a non-editable inline chip (subproject 🅓). Shows a
// readable label (e.g. 资质证书) while the node keeps the verbatim marker in
// `raw` for serialization. contentEditable={false} keeps the caret out of it —
// the user selects/deletes the whole chip or replaces it by typing over it.
export function BidPlaceholderChip({ node }: ReactNodeViewProps) {
  const raw = String(node.attrs.raw ?? '')
  return (
    <NodeViewWrapper
      as="span"
      className="bid-placeholder-chip"
      data-testid="bid-placeholder-chip"
      data-raw={raw}
      contentEditable={false}
    >
      {chipLabel(raw)}
    </NodeViewWrapper>
  )
}
