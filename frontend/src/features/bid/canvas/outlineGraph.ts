// SPDX-License-Identifier: Apache-2.0
//
// Pure model + layout engine for the Stage-1 outline canvas.
//
// The canvas operates on a FLAT node list ({id, parentId, order, name}), which
// mirrors the design's dc-runtime model. Node positions are DERIVED from the
// tree (depth -> column, DFS cursor -> row) rather than persisted per node, so
// the tree structure (parentId + order) is the single source of truth. Dragging
// mutates parentId/order (reparent or reorder) and the layout recomputes.
//
// The nested OutlineDoc.sections tree used by the rest of the app is converted
// to/from this flat list at the component boundary via flattenOutline /
// outlineFromFlat.

import type { OutlineNode } from '@/apis/bid'

export interface FlatNode {
  id: string
  parentId: string | null
  order: number
  name: string
  covers: string[]
}

export interface NodePos {
  x: number
  y: number
  depth: number
}

export interface Layout {
  pos: Record<string, NodePos>
  byParent: Record<string, FlatNode[]>
  collapsedSet: Set<string>
  NW: number
  NH: number
  COLW: number
  ROWH: number
  zoom: number
  width: number
  height: number
}

export interface DragState {
  id: string
  startX: number
  startY: number
  dx: number
  dy: number
  moved: boolean
}

export interface MarqueeState {
  x0: number
  y0: number
  x1: number
  y1: number
}

// Base node/column dimensions at zoom = 1 (from the design's computeLayout).
export const CANVAS_BASE = { NW: 200, NH: 56, COLW: 256, ROWH: 70 }
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 1.4
export const ZOOM_STEP = 0.1

// Chapter accent palette cycled across top-level chapters (design chapterPalette).
export const CHAPTER_PALETTE = ['#C7102A', '#B5451F', '#9C2B4E', '#A3121A', '#C2410C', '#8E2140']

const ROOT = '__root__'

let uid = 0
export function genNodeId(): string {
  uid += 1
  return `n${Date.now()}_${uid}`
}

// ---- tree <-> flat conversion -------------------------------------------------

export function flattenOutline(sections: OutlineNode[] | undefined): FlatNode[] {
  const out: FlatNode[] = []
  const walk = (nodes: OutlineNode[], parentId: string | null) => {
    nodes.forEach((n, i) => {
      // Fall back to a deterministic path-based id so identity is stable across
      // renders when a source node lacks an explicit id.
      const id = (n.id as string) || `auto-${parentId ?? 'root'}-${i}`
      out.push({
        id,
        parentId,
        order: i,
        name: (n.title as string) ?? '',
        covers: (n.covers as string[]) ?? [],
      })
      if (Array.isArray(n.children) && n.children.length) walk(n.children, id)
    })
  }
  walk(sections ?? [], null)
  return out
}

export function outlineFromFlat(flat: FlatNode[]): OutlineNode[] {
  const byParent = groupByParent(flat)
  const build = (parentId: string): OutlineNode[] =>
    (byParent[parentId] ?? []).map(n => {
      const children = build(n.id)
      return {
        id: n.id,
        title: n.name,
        ...(n.covers.length ? { covers: n.covers } : {}),
        ...(children.length ? { children } : {}),
      }
    })
  return build(ROOT)
}

// ---- layout -------------------------------------------------------------------

function groupByParent(flat: FlatNode[]): Record<string, FlatNode[]> {
  const byParent: Record<string, FlatNode[]> = {}
  flat.forEach(n => {
    const p = n.parentId ?? ROOT
    ;(byParent[p] ||= []).push(n)
  })
  Object.values(byParent).forEach(arr => arr.sort((a, b) => a.order - b.order))
  return byParent
}

export function computeLayout(flat: FlatNode[], collapsed: Set<string>, zoom: number): Layout {
  const NW = Math.round(CANVAS_BASE.NW * zoom)
  const NH = Math.round(CANVAS_BASE.NH * zoom)
  const COLW = Math.round(CANVAS_BASE.COLW * zoom)
  const ROWH = Math.round(CANVAS_BASE.ROWH * zoom)
  const byParent = groupByParent(flat)
  const pos: Record<string, NodePos> = {}
  let cursor = 0
  const visit = (id: string, depth: number): number => {
    const kids = byParent[id] ?? []
    if (!kids.length || collapsed.has(id)) {
      pos[id] = { x: depth * COLW, y: cursor * ROWH, depth }
      cursor += 1
      return pos[id].y
    }
    const ys = kids.map(k => visit(k.id, depth + 1))
    pos[id] = { x: depth * COLW, y: (Math.min(...ys) + Math.max(...ys)) / 2, depth }
    return pos[id].y
  }
  ;(byParent[ROOT] ?? []).forEach(r => visit(r.id, 0))
  const positions = Object.values(pos)
  const maxX = positions.length ? Math.max(...positions.map(p => p.x)) : 0
  const maxY = positions.length ? Math.max(...positions.map(p => p.y)) : 0
  return {
    pos,
    byParent,
    collapsedSet: collapsed,
    NW,
    NH,
    COLW,
    ROWH,
    zoom,
    width: maxX + NW + 140,
    height: maxY + NH + 100,
  }
}

// ---- tree helpers -------------------------------------------------------------

export function childrenOf(flat: FlatNode[], id: string | null): FlatNode[] {
  return flat.filter(n => n.parentId === id).sort((a, b) => a.order - b.order)
}

export function isDescendantOf(flat: FlatNode[], ancestorId: string, id: string): boolean {
  const map = new Map(flat.map(n => [n.id, n]))
  let cur = map.get(id)
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true
    cur = map.get(cur.parentId)
  }
  return false
}

export function countDescendants(flat: FlatNode[], id: string): number {
  return childrenOf(flat, id).reduce((sum, k) => sum + 1 + countDescendants(flat, k.id), 0)
}

export interface DepthNode extends FlatNode {
  depth: number
}

/** Depth-first, order-respecting traversal with a depth on each node. */
export function dfsOrder(flat: FlatNode[]): DepthNode[] {
  const result: DepthNode[] = []
  const visit = (id: string | null, depth: number) => {
    childrenOf(flat, id).forEach(n => {
      result.push({ ...n, depth })
      visit(n.id, depth + 1)
    })
  }
  visit(null, 0)
  return result
}

/** Leaf nodes (no children) in DFS order. */
export function leavesOf(flat: FlatNode[]): DepthNode[] {
  return dfsOrder(flat).filter(n => !flat.some(x => x.parentId === n.id))
}

/** A node is visible when none of its ancestors are collapsed. */
export function isVisible(flat: FlatNode[], node: FlatNode, collapsed: Set<string>): boolean {
  const map = new Map(flat.map(n => [n.id, n]))
  let cur = node.parentId ? map.get(node.parentId) : null
  while (cur) {
    if (collapsed.has(cur.id)) return false
    cur = cur.parentId ? map.get(cur.parentId) : null
  }
  return true
}

export function chapterColor(flat: FlatNode[], id: string): string {
  const map = new Map(flat.map(n => [n.id, n]))
  let cur = map.get(id)
  if (!cur) return CHAPTER_PALETTE[0]
  while (cur.parentId) {
    const next = map.get(cur.parentId)
    if (!next) break
    cur = next
  }
  const chapters = childrenOf(flat, null)
  const idx = chapters.findIndex(c => c.id === cur!.id)
  return CHAPTER_PALETTE[(idx >= 0 ? idx : 0) % CHAPTER_PALETTE.length]
}

// ---- drag / marquee reducers (pure) -------------------------------------------

/**
 * Resolve a drag drop into a new flat list.
 * - Dropped onto another node (not self / descendant) -> reparent as its child.
 * - Otherwise, if horizontal travel is small -> reorder within the same parent.
 * - Otherwise -> no structural change (returns null so the node snaps back).
 */
export function applyDrop(flat: FlatNode[], layout: Layout, drag: DragState): FlatNode[] | null {
  const { pos, NW, NH, COLW } = layout
  const node = flat.find(n => n.id === drag.id)
  const p = pos[drag.id]
  if (!node || !p) return null
  const dropCenterX = p.x + NW / 2 + drag.dx
  const dropCenterY = p.y + NH / 2 + drag.dy

  let target: FlatNode | null = null
  for (const n of flat) {
    if (n.id === drag.id) continue
    if (isDescendantOf(flat, drag.id, n.id)) continue
    const np = pos[n.id]
    if (!np) continue
    if (
      dropCenterX >= np.x &&
      dropCenterX <= np.x + NW &&
      dropCenterY >= np.y &&
      dropCenterY <= np.y + NH
    ) {
      target = n
      break
    }
  }

  let nodes = flat.slice()
  if (target) {
    const siblings = childrenOf(nodes, target.id)
    const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order), -1)
    nodes = nodes.map(n =>
      n.id === drag.id ? { ...n, parentId: target!.id, order: maxOrder + 1 } : n
    )
    return nodes
  }
  if (Math.abs(drag.dx) < COLW * 0.6) {
    const parentId = node.parentId
    const siblings = childrenOf(nodes, parentId).filter(s => s.id !== drag.id)
    let insertIndex = siblings.length
    for (let i = 0; i < siblings.length; i++) {
      const sp = pos[siblings[i].id]
      if (sp && dropCenterY < sp.y + NH / 2) {
        insertIndex = i
        break
      }
    }
    siblings.splice(insertIndex, 0, node)
    const reordered = new Map(siblings.map((s, i) => [s.id, i]))
    nodes = nodes.map(n => (reordered.has(n.id) ? { ...n, order: reordered.get(n.id)! } : n))
    return nodes
  }
  return null
}

export function marqueeSelect(flat: FlatNode[], layout: Layout, m: MarqueeState): string[] {
  const { pos, NW, NH } = layout
  const x0 = Math.min(m.x0, m.x1)
  const x1 = Math.max(m.x0, m.x1)
  const y0 = Math.min(m.y0, m.y1)
  const y1 = Math.max(m.y0, m.y1)
  return flat
    .filter(n => {
      const p = pos[n.id]
      if (!p) return false
      return p.x < x1 && p.x + NW > x0 && p.y < y1 && p.y + NH > y0
    })
    .map(n => n.id)
}

// ---- edges --------------------------------------------------------------------

export interface CanvasEdge {
  id: string
  d: string
  stroke: string
  strokeWidth: number
}

export function buildEdges(
  flat: FlatNode[],
  layout: Layout,
  opts: { selectedId: string | null; dragId: string | null }
): CanvasEdge[] {
  const { pos, byParent, collapsedSet, NW, NH } = layout
  const edges: CanvasEdge[] = []
  flat.forEach(n => {
    if (!pos[n.id] || collapsedSet.has(n.id)) return
    ;(byParent[n.id] ?? []).forEach(c => {
      if (!pos[c.id]) return
      const p = pos[n.id]
      const q = pos[c.id]
      const px = p.x + NW
      const py = p.y + NH / 2
      const cx = q.x
      const cy = q.y + NH / 2
      const midx = (px + cx) / 2
      const dim = opts.dragId === n.id
      const highlighted =
        !!opts.selectedId && (n.id === opts.selectedId || c.id === opts.selectedId)
      let stroke = '#C9C2BC'
      let strokeWidth = 2
      if (dim) stroke = '#E5DFDA'
      else if (highlighted) {
        stroke = 'var(--bid-primary)'
        strokeWidth = 2.5
      }
      edges.push({
        id: `${n.id}_${c.id}`,
        d: `M ${px} ${py} C ${midx} ${py} ${midx} ${cy} ${cx} ${cy}`,
        stroke,
        strokeWidth,
      })
    })
  })
  return edges
}
