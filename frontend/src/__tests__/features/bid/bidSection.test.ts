// SPDX-License-Identifier: Apache-2.0
import { BidSection, type BidSectionStatus } from '@/features/bid/extensions/bidSection'

// The Jest environment stubs StarterKit/Markdown (see jest.config.ts), so a
// real `new Editor({ extensions: [StarterKit, BidSection] })` cannot compile a
// schema here. We instead assert the node-definition CONTRACT directly against
// the TipTap extension object — exactly what spec/plan Task 2 requires: the
// addressing attrs, the isolating wrapper, and the markdown.serialize spec
// that lets per-section serialization emit body-only markdown (spike §1, §2).
// Round-trip FIDELITY is exercised in the Task 9 browser smoke (reviewer
// constraint #2); here we guarantee the contract the real editor will load.

describe('BidSection node definition', () => {
  // Node.create() returns an extension whose spec lives under `.config`
  // (name is also surfaced at the top). Assert the contract the real editor
  // will compile into a schema — see spike-notes §1/§2.
  const ext = BidSection as unknown as {
    name: string
    config: {
      group?: string
      content?: string
      isolating?: boolean
      defining?: boolean
      addAttributes?: () => Record<string, { default: unknown }>
      addOptions?: () => Record<string, unknown>
      addStorage?: () => Record<string, unknown>
    }
  }
  const config = ext.config

  test('is a TipTap node extension named bidSection with isolating block+ content', () => {
    expect(ext.name).toBe('bidSection')
    expect(config.group).toBe('bidSectionGroup')
    expect(config.content).toBe('block+')
    expect(config.isolating).toBe(true)
    expect(config.defining).toBe(true)
  })

  test('declares the addressing + CAS attrs used to persist each section', () => {
    const attrs = config.addAttributes!()
    expect(Object.keys(attrs)).toEqual(['sectionId', 'version', 'status', 'accepted'])
    expect(attrs.sectionId.default).toBe('')
    expect(attrs.version.default).toBe('')
    expect(attrs.status.default).toBe('pending')
    expect(attrs.accepted.default).toBe(false)
  })

  test('status attr default covers the drafting lifecycle states', () => {
    const allowed: BidSectionStatus[] = ['pending', 'drafting', 'done', 'needs_rework']
    // Runtime status is validated at the editor-assembly layer (Task 7); here
    // we lock the default + the union the editor will switch among.
    expect(allowed).toContain(config.addAttributes!().status.default as BidSectionStatus)
  })

  test('provides a markdown.serialize spec that renders only its children', () => {
    // Without this, tiptap-markdown's whole-doc getMarkdown() traversal would
    // choke on the wrapper and per-section serialization would emit junk.
    const storage = config.addStorage!()
    expect(typeof storage.markdown).toBe('object')
    const serialize = (storage.markdown as { serialize: unknown }).serialize
    expect(typeof serialize).toBe('function')
    // The serialize hook must call renderContent(node) — render the section's
    // child blocks and nothing else (no wrapper, no title).
    const state = { renderContent: jest.fn() }
    const fakeNode = { type: { name: 'bidSection' } }
    ;(serialize as (s: typeof state, n: typeof fakeNode) => void)(state, fakeNode)
    expect(state.renderContent).toHaveBeenCalledTimes(1)
    expect(state.renderContent).toHaveBeenCalledWith(fakeNode)
  })

  test('accepts a sectionNames option so the NodeView can render outline titles', () => {
    expect(config.addOptions!()).toEqual({ sectionNames: {} })
  })
})
