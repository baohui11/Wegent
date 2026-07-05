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

// Base node/column dimensions at zoom = 1. Nodes are tall enough for a 2-line
// wrapped title (readability) instead of a single truncated line.
export const CANVAS_BASE = { NW: 216, NH: 64, COLW: 288, ROWH: 84 }
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
  const root = rootChapterId(flat, id)
  const chapters = childrenOf(flat, null)
  const idx = chapters.findIndex(c => c.id === root)
  return CHAPTER_PALETTE[(idx >= 0 ? idx : 0) % CHAPTER_PALETTE.length]
}

/**
 * Walk the parent chain from `id` up to its top-level (root) chapter and return
 * that chapter's id. Single source for "which root chapter does this node belong
 * to?" — shared by `chapterColor` (palette index) and DraftingScreen's
 * per-section status inheritance. Falls back to `id` itself when the node is a
 * root chapter or its id is not in the flat tree.
 */
export function rootChapterId(flat: FlatNode[], id: string): string {
  const map = new Map(flat.map(n => [n.id, n]))
  let cur = map.get(id)
  if (!cur) return id
  while (cur.parentId) {
    const next = map.get(cur.parentId)
    if (!next) break
    cur = next
  }
  return cur.id
}

// ---- drag / marquee reducers (pure) -------------------------------------------

/**
 * A resolved drop decision, computed live during a drag so the UI can preview it.
 * - `reparent`: dropping snaps the node under `targetId` (nearest node within
 *   range). `ghostX/Y` is the projected landing slot (a placeholder is drawn
 *   there); `edge` connects the target's right to that slot's left. The preview
 *   points at where the node WILL land, not at the cursor, so it stays clean.
 * - `reorder`: dropping between siblings inserts at `insertIndex`; the
 *   `lineX/Y/W` describe the insertion indicator.
 * - `null`: no target in range (the node snaps back).
 */
export type DropHint =
  | { kind: 'reparent'; targetId: string; edge: string; ghostX: number; ghostY: number }
  | {
      kind: 'reorder'
      parentId: string | null
      insertIndex: number
      lineX: number
      lineY: number
      lineW: number
    }
  | null

/**
 * Resolve the current drag into a drop decision without mutating anything.
 *
 * Forgiving and POSITION-based (not travel-based): decisions come from where the
 * cursor is relative to the nearest node, so a node that starts on the right and
 * barely moves still snaps onto a neighbour.
 * - Nearest node measured to its BOX (0 inside, gap size outside), within a
 *   generous radius. Beyond it -> null (snap back).
 * - Cursor over a SIBLING's own column (not its right child-zone) -> reorder.
 * - Otherwise -> reparent under the nearest node (its child).
 */
export function resolveDrop(flat: FlatNode[], layout: Layout, drag: DragState): DropHint {
  const { pos, byParent, NW, NH, COLW, ROWH } = layout
  const node = flat.find(n => n.id === drag.id)
  const p = pos[drag.id]
  if (!node || !p) return null
  const cx = p.x + NW / 2 + drag.dx
  const cy = p.y + NH / 2 + drag.dy

  // Nearest eligible node by distance to its BOX (0 when the cursor is inside,
  // the gap size when outside) — so dragging just beside/behind a node reads as
  // near, unlike a center-to-center metric.
  let best: FlatNode | null = null
  let bestDist = Infinity
  for (const n of flat) {
    if (n.id === drag.id) continue
    if (isDescendantOf(flat, drag.id, n.id)) continue
    const np = pos[n.id]
    if (!np) continue
    const gapX = Math.max(np.x - cx, 0, cx - (np.x + NW))
    const gapY = Math.max(np.y - cy, 0, cy - (np.y + NH))
    const d = Math.hypot(gapX, gapY)
    if (d < bestDist) {
      bestDist = d
      best = n
    }
  }
  const SNAP_RADIUS = COLW // generous empty-space gap counts as "on it"
  if (!best || bestDist > SNAP_RADIUS) return null

  // Reorder vs reparent by POSITION relative to the nearest node: if it is a
  // sibling and the cursor sits over its own column (left of its child-zone),
  // the user is repositioning within the column -> reorder. Otherwise reparent.
  const bp = pos[best.id]
  const inChildZone = cx > bp.x + NW * 0.6
  if (best.parentId === node.parentId && !inChildZone) {
    const parentId = node.parentId
    const siblings = childrenOf(flat, parentId).filter(s => s.id !== drag.id)
    let insertIndex = siblings.length
    for (let i = 0; i < siblings.length; i++) {
      const sp = pos[siblings[i].id]
      if (sp && cy < sp.y + NH / 2) {
        insertIndex = i
        break
      }
    }
    const depth = pos[node.id]?.depth ?? 0
    const above = siblings[insertIndex]
    const below = siblings[insertIndex - 1]
    const lineY = above
      ? (pos[above.id]?.y ?? 0) - 6
      : below
        ? (pos[below.id]?.y ?? 0) + NH + 6
        : cy - NH / 2
    return { kind: 'reorder', parentId, insertIndex, lineX: depth * COLW, lineY, lineW: NW }
  }
  // Landing slot: where the node WILL sit as best's child — one column right of
  // the target, below its existing (laid-out) children. The preview points here,
  // NOT at the cursor, so the connector is always a clean left→right curve.
  const tp = pos[best.id]
  const kids = (byParent[best.id] ?? []).filter(k => k.id !== drag.id && pos[k.id])
  const ghostX = tp.x + COLW
  const ghostY = kids.length ? Math.max(...kids.map(k => pos[k.id].y)) + ROWH : tp.y
  const sx = tp.x + NW
  const sy = tp.y + NH / 2
  const ey = ghostY + NH / 2
  const midx = (sx + ghostX) / 2
  const edge = `M ${sx} ${sy} C ${midx} ${sy} ${midx} ${ey} ${ghostX} ${ey}`
  return { kind: 'reparent', targetId: best.id, edge, ghostX, ghostY }
}

/**
 * Apply a drag drop into a new flat list (or null to snap back), reusing the
 * live `resolveDrop` decision so preview and commit never diverge.
 */
export function applyDrop(flat: FlatNode[], layout: Layout, drag: DragState): FlatNode[] | null {
  const hint = resolveDrop(flat, layout, drag)
  if (!hint) return null
  const node = flat.find(n => n.id === drag.id)
  if (!node) return null

  if (hint.kind === 'reparent') {
    const siblings = childrenOf(flat, hint.targetId)
    const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order), -1)
    return flat.map(n =>
      n.id === drag.id ? { ...n, parentId: hint.targetId, order: maxOrder + 1 } : n
    )
  }
  const siblings = childrenOf(flat, hint.parentId).filter(s => s.id !== drag.id)
  siblings.splice(hint.insertIndex, 0, node)
  const reordered = new Map(siblings.map((s, i) => [s.id, i]))
  return flat.map(n => (reordered.has(n.id) ? { ...n, order: reordered.get(n.id)! } : n))
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
      // Hide edges touching the dragged node: it has moved away from its layout
      // slot, so drawing to the old slot leaves a detached stub. The live drop
      // preview (snap edge) shows the pending connection instead.
      if (opts.dragId && (n.id === opts.dragId || c.id === opts.dragId)) return
      const p = pos[n.id]
      const q = pos[c.id]
      const px = p.x + NW
      const py = p.y + NH / 2
      const cx = q.x
      const cy = q.y + NH / 2
      const midx = (px + cx) / 2
      const highlighted =
        !!opts.selectedId && (n.id === opts.selectedId || c.id === opts.selectedId)
      let stroke = '#C9C2BC'
      let strokeWidth = 2
      if (highlighted) {
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
