// SPDX-License-Identifier: Apache-2.0

import {
  applyDrop,
  CANVAS_BASE,
  chapterColor,
  computeLayout,
  flattenOutline,
  isDescendantOf,
  marqueeSelect,
  outlineFromFlat,
  resolveDrop,
  rootChapterId,
} from '@/features/bid/canvas/outlineGraph'
import type { OutlineDoc } from '@/apis/bid'

const OUTLINE: OutlineDoc = {
  sections: [
    {
      id: 'c1',
      title: 'Chapter 1',
      covers: ['T1'],
      children: [
        { id: 'c1a', title: '1.1' },
        { id: 'c1b', title: '1.2' },
      ],
    },
    { id: 'c2', title: 'Chapter 2', children: [{ id: 'c2a', title: '2.1' }] },
  ],
}

const flat = () => flattenOutline(OUTLINE.sections)

describe('flatten/outlineFromFlat roundtrip', () => {
  it('flattens the nested tree into parentId/order records', () => {
    const f = flat()
    expect(f).toHaveLength(5)
    expect(f.find(n => n.id === 'c1a')).toMatchObject({ parentId: 'c1', order: 0 })
    expect(f.find(n => n.id === 'c2')).toMatchObject({ parentId: null, order: 1 })
  })

  it('reconstructs an equivalent nested tree', () => {
    const tree = outlineFromFlat(flat())
    expect(tree).toEqual(OUTLINE.sections)
  })
})

describe('computeLayout', () => {
  it('places chapters in column 0 and children in column 1, scaled by zoom', () => {
    const layout = computeLayout(flat(), new Set(), 1)
    expect(layout.pos.c1.depth).toBe(0)
    expect(layout.pos.c1a.depth).toBe(1)
    expect(layout.pos.c1.x).toBe(0)
    expect(layout.pos.c1a.x).toBe(CANVAS_BASE.COLW)
    const zoomed = computeLayout(flat(), new Set(), 1.4)
    expect(zoomed.pos.c1a.x).toBe(Math.round(CANVAS_BASE.COLW * 1.4))
  })

  it('treats collapsed nodes as leaves (children not laid out below)', () => {
    const layout = computeLayout(flat(), new Set(['c1']), 1)
    // c2 should immediately follow the collapsed c1 rather than after c1's kids.
    expect(layout.pos.c2.y).toBe(layout.ROWH)
  })
})

describe('applyDrop', () => {
  it('reparents a node dropped onto another node', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    // Drop c2a onto c1: dx/dy carry its center into c1's box.
    const c2a = layout.pos.c2a
    const c1 = layout.pos.c1
    const drag = {
      id: 'c2a',
      startX: 0,
      startY: 0,
      dx: c1.x - c2a.x,
      dy: c1.y - c2a.y,
      moved: true,
    }
    const next = applyDrop(f, layout, drag)!
    expect(next.find(n => n.id === 'c2a')!.parentId).toBe('c1')
  })

  it('reorders within the same parent when dropped in empty vertical space', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    // Drag c1b up above all nodes (small dx, dropCenterY < 0 -> no target node)
    // so it reorders ahead of its sibling c1a.
    const drag = {
      id: 'c1b',
      startX: 0,
      startY: 0,
      dx: 0,
      dy: -(layout.ROWH + layout.NH),
      moved: true,
    }
    const next = applyDrop(f, layout, drag)!
    const orders = Object.fromEntries(
      next.filter(n => n.parentId === 'c1').map(n => [n.id, n.order])
    )
    expect(orders.c1b).toBeLessThan(orders.c1a)
  })

  it('returns null when a node is dropped in empty space far from its column', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    const drag = { id: 'c1a', startX: 0, startY: 0, dx: 4000, dy: 4000, moved: true }
    expect(applyDrop(f, layout, drag)).toBeNull()
  })

  it('never reparents a node onto its own descendant', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    const c1a = layout.pos.c1a
    const c1 = layout.pos.c1
    // Try to drop c1 onto its child c1a.
    const drag = {
      id: 'c1',
      startX: 0,
      startY: 0,
      dx: c1a.x - c1.x,
      dy: c1a.y - c1.y,
      moved: true,
    }
    const next = applyDrop(f, layout, drag)
    // c1a stays a child of c1; c1 does not become a child of c1a.
    if (next) expect(next.find(n => n.id === 'c1')!.parentId).not.toBe('c1a')
  })
})

describe('resolveDrop (live preview matches applyDrop commit)', () => {
  it('previews a reparent target', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    const c2a = layout.pos.c2a
    const c1 = layout.pos.c1
    const drag = {
      id: 'c2a',
      startX: 0,
      startY: 0,
      dx: c1.x - c2a.x,
      dy: c1.y - c2a.y,
      moved: true,
    }
    const hint = resolveDrop(f, layout, drag)
    expect(hint).toMatchObject({ kind: 'reparent', targetId: 'c1' })
    if (hint?.kind === 'reparent') expect(hint.edge).toContain('M ') // snap-edge path
  })

  it('snaps to the nearest node without exact overlap (forgiving drop)', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    const c2a = layout.pos.c2a
    const c1 = layout.pos.c1
    // Aim roughly toward c1 but stop ~half a node short — should still snap to c1.
    const drag = {
      id: 'c2a',
      startX: 0,
      startY: 0,
      dx: c1.x - c2a.x + 30,
      dy: c1.y - c2a.y + 20,
      moved: true,
    }
    const hint = resolveDrop(f, layout, drag)
    expect(hint).toMatchObject({ kind: 'reparent', targetId: 'c1' })
  })

  it('previews a reorder with an insertion line', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    const drag = {
      id: 'c1b',
      startX: 0,
      startY: 0,
      dx: 0,
      dy: -(layout.ROWH + layout.NH),
      moved: true,
    }
    const hint = resolveDrop(f, layout, drag)
    expect(hint?.kind).toBe('reorder')
    if (hint?.kind === 'reorder') expect(hint.insertIndex).toBe(0)
  })

  it('returns null far from any target', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    const drag = { id: 'c1a', startX: 0, startY: 0, dx: 4000, dy: 4000, moved: true }
    expect(resolveDrop(f, layout, drag)).toBeNull()
  })
})

describe('marqueeSelect', () => {
  it('selects nodes whose box intersects the rectangle', () => {
    const f = flat()
    const layout = computeLayout(f, new Set(), 1)
    // Rectangle covering only column 0 (chapters).
    const ids = marqueeSelect(f, layout, { x0: -10, y0: -10, x1: 100, y1: 10000 })
    expect(ids).toContain('c1')
    expect(ids).toContain('c2')
    expect(ids).not.toContain('c1a')
  })
})

describe('helpers', () => {
  it('isDescendantOf detects nested descendants', () => {
    const f = flat()
    expect(isDescendantOf(f, 'c1', 'c1a')).toBe(true)
    expect(isDescendantOf(f, 'c2', 'c1a')).toBe(false)
  })

  it('chapterColor is stable per top-level chapter and inherited by children', () => {
    const f = flat()
    expect(chapterColor(f, 'c1a')).toBe(chapterColor(f, 'c1'))
    expect(chapterColor(f, 'c1')).not.toBe(chapterColor(f, 'c2'))
  })

  it('rootChapterId walks the parent chain back to the top-level chapter', () => {
    const f = flat()
    // A leaf resolves to its enclosing chapter; a chapter resolves to itself.
    expect(rootChapterId(f, 'c1a')).toBe('c1')
    expect(rootChapterId(f, 'c1')).toBe('c1')
    // Unknown id falls back to itself (no parent chain to walk).
    expect(rootChapterId(f, 'nope')).toBe('nope')
  })
})
