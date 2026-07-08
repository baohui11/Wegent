// SPDX-License-Identifier: Apache-2.0
import { deriveOutline } from '@/features/bid/canvas/documentOutline'

// Minimal fakes honoring the ProseMirror contract deriveOutline relies on:
// node.type.name, node.attrs, node.forEach((child)=>...), child.textContent,
// child.nodeSize. Testing the pure derivation directly sidesteps the Jest
// tiptap mock (which is exactly what hides real editor behaviour).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function heading(level: number, text: string): any {
  return {
    type: { name: 'heading' },
    attrs: { level },
    textContent: text,
    nodeSize: text.length + 2,
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function para(text: string): any {
  return { type: { name: 'paragraph' }, attrs: {}, textContent: text, nodeSize: text.length + 2 }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function section(sectionId: string, children: any[]): any {
  return {
    type: { name: 'bidSection' },
    attrs: { sectionId },
    nodeSize: children.reduce((s, c) => s + c.nodeSize, 0) + 2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forEach(fn: (c: any) => void) {
      children.forEach(fn)
    },
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function doc(sections: any[]): any {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forEach(fn: (n: any, offset: number) => void) {
      let offset = 0
      sections.forEach(s => {
        fn(s, offset)
        offset += s.nodeSize
      })
    },
  }
}

test('derives sections then their in-body headings in document order', () => {
  const d = doc([
    section('s1', [heading(2, '系统架构'), para('正文'), heading(3, '技术选型')]),
    section('s2', []),
  ])
  const entries = deriveOutline(d, { s1: '第一章', s2: '第二章' })
  expect(entries.map(e => [e.kind, e.sectionId, e.level, e.text])).toEqual([
    ['section', 's1', 1, '第一章'],
    ['heading', 's1', 2, '系统架构'],
    ['heading', 's1', 3, '技术选型'],
    ['section', 's2', 1, '第二章'],
  ])
})

test('section text falls back to the id when no name is given', () => {
  const entries = deriveOutline(doc([section('s1', [])]), {})
  expect(entries[0].text).toBe('s1')
  expect(entries[0].kind).toBe('section')
})

test('non-heading blocks are not outline entries', () => {
  const entries = deriveOutline(doc([section('s1', [para('a'), para('b')])]), { s1: 'X' })
  expect(entries).toHaveLength(1)
})

test('heading keys are unique per section+position', () => {
  const entries = deriveOutline(doc([section('s1', [heading(2, 'A'), heading(2, 'B')])]), {})
  const headingKeys = entries.filter(e => e.kind === 'heading').map(e => e.key)
  expect(new Set(headingKeys).size).toBe(2)
})
