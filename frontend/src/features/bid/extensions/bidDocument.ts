// SPDX-License-Identifier: Apache-2.0

import { Node } from '@tiptap/core'

// Top-level document node for the single-document bid editor. Its content spec
// is `bidSection+` so users literally cannot type outside a section — every
// block belongs to exactly one section and every section is independently
// addressable (CAS-saved / redraft-ranged). Replaces StarterKit's bundled
// Document (which allows arbitrary `block+` at the doc root). Wired in via
// `StarterKit.configure({ document: false })` + this extension.
export const BidDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'bidSection+',
})
