// SPDX-License-Identifier: Apache-2.0

import {
  attrSignature,
  contentSignature,
  type SectionSyncSpec,
} from '@/features/bid/canvas/docSync'

const base: SectionSyncSpec[] = [
  { id: 's1', content: 'Body one', version: 'v1', accepted: false },
  { id: 's2', content: 'Body two', version: 'v1', accepted: false },
]

describe('docSync signatures', () => {
  describe('contentSignature', () => {
    it('is stable when only version changes (autosave write-back)', () => {
      // The core regression guard: a save bumps `version` on the same body.
      // If contentSignature reacted to it, the document editor would rebuild
      // from the last-fetched body and revert the user's just-saved edit.
      const afterSave = base.map(s => (s.id === 's1' ? { ...s, version: 'v2' } : s))
      expect(contentSignature(afterSave)).toBe(contentSignature(base))
    })

    it('is stable when only accepted changes', () => {
      const afterAccept = base.map(s => (s.id === 's1' ? { ...s, accepted: true } : s))
      expect(contentSignature(afterAccept)).toBe(contentSignature(base))
    })

    it('changes when a section body changes (redraft / regen)', () => {
      const afterRedraft = base.map(s =>
        s.id === 's1' ? { ...s, content: 'Rewritten body one' } : s
      )
      expect(contentSignature(afterRedraft)).not.toBe(contentSignature(base))
    })

    it('changes when a section is added (a new section finishes drafting)', () => {
      const withNew: SectionSyncSpec[] = [
        ...base,
        { id: 's3', content: 'Body three', version: 'v1', accepted: false },
      ]
      expect(contentSignature(withNew)).not.toBe(contentSignature(base))
    })

    it('changes when section order changes', () => {
      const reordered = [base[1], base[0]]
      expect(contentSignature(reordered)).not.toBe(contentSignature(base))
    })
  })

  describe('attrSignature', () => {
    it('changes when version changes', () => {
      const afterSave = base.map(s => (s.id === 's1' ? { ...s, version: 'v2' } : s))
      expect(attrSignature(afterSave)).not.toBe(attrSignature(base))
    })

    it('changes when accepted changes', () => {
      const afterAccept = base.map(s => (s.id === 's1' ? { ...s, accepted: true } : s))
      expect(attrSignature(afterAccept)).not.toBe(attrSignature(base))
    })

    it('is stable when only the body changes', () => {
      const afterRedraft = base.map(s =>
        s.id === 's1' ? { ...s, content: 'Rewritten body one' } : s
      )
      expect(attrSignature(afterRedraft)).toBe(attrSignature(base))
    })
  })
})
