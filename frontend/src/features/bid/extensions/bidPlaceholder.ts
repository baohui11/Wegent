// SPDX-License-Identifier: Apache-2.0

import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { BidPlaceholderChip } from '../components/BidPlaceholderChip'

// Minimal shape of the tiptap-markdown serializer state we use: write() appends
// text verbatim (no markdown escaping), which is what preserves `[待填…]` and
// `{{…}}` exactly on round-trip (state.text() would escape the brackets).
interface MarkdownWriteState {
  write(text: string): void
}

// An atomic, inline, non-editable placeholder chip (subproject 🅓). It carries
// the verbatim source marker in `raw` so it renders as a pill via its NodeView
// and serializes back to the exact original text. `atom: true` makes it a single
// indivisible token — the caret can't land inside it, only select/delete it.
export const BidPlaceholder = Node.create({
  name: 'bidPlaceholder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: el => el.getAttribute('data-bid-placeholder') ?? '',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-bid-placeholder]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        ...HTMLAttributes,
        'data-bid-placeholder': HTMLAttributes.raw,
        class: 'bid-placeholder-chip',
      },
      HTMLAttributes.raw,
    ]
  },

  addStorage() {
    return {
      // tiptap-markdown discovers this; emit the raw marker verbatim so the
      // section body round-trips to exactly what the backend stores.
      markdown: {
        serialize(state: MarkdownWriteState, node: { attrs: { raw: string } }) {
          state.write(node.attrs.raw ?? '')
        },
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(BidPlaceholderChip)
  },
})
