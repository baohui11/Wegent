// SPDX-License-Identifier: Apache-2.0

import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { MarkdownSerializerState } from '@tiptap/pm/markdown'
import { BidSectionNodeView } from '../components/BidSectionNodeView'

export type BidSectionStatus = 'pending' | 'drafting' | 'done' | 'needs_rework'

export interface BidSectionOptions {
  // Outline sectionId -> human title. The NodeView renders this title once
  // (the body markdown carries no heading anymore, see spike-notes §6); a
  // placeholder is derived when an outline name is missing.
  sectionNames?: Record<string, string>
}

// A top-level document block that owns exactly one bid section. It is
// `isolating` so edits/merges/delete-pressures never cross section boundaries,
// which lets us serialize and CAS-save each section independently (the backend
// is strictly per-section). The body lives in its children; the section's own
// heading is rendered by the NodeView from the outline name, so the markdown
// serialization must emit ONLY the children — hence the `markdown.serialize`
// spec calls `state.renderContent(node)` with no wrapper syntax.
export const BidSection = Node.create<BidSectionOptions>({
  name: 'bidSection',
  group: 'bidSectionGroup',
  content: 'block+',
  isolating: true,
  defining: true,

  addOptions() {
    return { sectionNames: {} }
  },

  addAttributes() {
    return {
      sectionId: {
        default: '',
        // renderHTML writes data-bid-section; parse it back symmetrically so
        // round-tripping the section (HTML -> PM -> HTML) preserves the id.
        parseHTML: el => el.getAttribute('data-bid-section') ?? '',
      },
      version: { default: '' },
      status: { default: 'pending' },
      accepted: { default: false },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-bid-section]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', { ...HTMLAttributes, 'data-bid-section': HTMLAttributes.sectionId }, 0]
  },

  addStorage() {
    return {
      // tiptap-markdown discovers this via getMarkdownSpec(extension). Emitting
      // only the children (no wrapper / no title) is what makes per-section
      // serialization produce exactly the body markdown.
      markdown: {
        serialize(state: MarkdownSerializerState, node) {
          state.renderContent(node)
        },
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(BidSectionNodeView)
  },
})
