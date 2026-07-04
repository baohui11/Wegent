// SPDX-License-Identifier: Apache-2.0
//
// Interaction state + handlers for the Stage-1 outline canvas.
//
// The canvas is CONTROLLED: the flat node list is derived from the `outline`
// prop, and every structural change (rename / add / delete / reparent / reorder)
// is committed back through `onSave` as a nested OutlineDoc. Ephemeral UI state
// (selection, editing, collapse, zoom, search, drag offset, marquee, viewport)
// lives here and never leaves the component.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OutlineDoc } from '@/apis/bid'
import {
  applyDrop,
  buildEdges,
  childrenOf,
  computeLayout,
  countDescendants,
  flattenOutline,
  genNodeId,
  marqueeSelect,
  outlineFromFlat,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  type DragState,
  type FlatNode,
  type MarqueeState,
} from './outlineGraph'

export interface Viewport {
  left: number
  top: number
  w: number
  h: number
}

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10))

export function useOutlineCanvas(
  outline: OutlineDoc | undefined,
  onSave: ((o: OutlineDoc) => void) | undefined,
  defaultNames: { chapter: string; node: string }
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(1)
  const [search, setSearch] = useState('')
  const [drag, setDrag] = useState<DragState | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [edits, setEdits] = useState(0)
  const [viewport, setViewport] = useState<Viewport>({ left: 0, top: 0, w: 0, h: 0 })

  const flat = useMemo(() => flattenOutline(outline?.sections), [outline])
  const layout = useMemo(() => computeLayout(flat, collapsed, zoom), [flat, collapsed, zoom])
  const edges = useMemo(
    () => buildEdges(flat, layout, { selectedId, dragId: drag?.id ?? null }),
    [flat, layout, selectedId, drag]
  )

  // Structural commit: push the mutated flat list back up as a nested outline.
  const commit = useCallback(
    (next: FlatNode[]) => {
      onSave?.({ ...outline, sections: outlineFromFlat(next) })
      setEdits(e => e + 1)
    },
    [onSave, outline]
  )

  // ---- selection / editing ----------------------------------------------------

  const startEditing = useCallback(
    (id: string) => {
      const n = flat.find(x => x.id === id)
      if (!n) return
      setEditingId(id)
      setEditingValue(n.name)
    },
    [flat]
  )

  const commitEditing = useCallback(() => {
    if (!editingId) return
    const id = editingId
    const value = editingValue.trim()
    setEditingId(null)
    setEditingValue('')
    const current = flat.find(n => n.id === id)
    if (!current || !value || value === current.name) return
    commit(flat.map(n => (n.id === id ? { ...n, name: value } : n)))
  }, [editingId, editingValue, flat, commit])

  // ---- collapse / zoom / search ----------------------------------------------

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const parentIds = useMemo(
    () => new Set(flat.filter(n => flat.some(c => c.parentId === n.id)).map(n => n.id)),
    [flat]
  )
  const expandAll = useCallback(() => setCollapsed(new Set()), [])
  const collapseAll = useCallback(() => setCollapsed(new Set(parentIds)), [parentIds])

  const zoomIn = useCallback(() => setZoom(z => clampZoom(z + ZOOM_STEP)), [])
  const zoomOut = useCallback(() => setZoom(z => clampZoom(z - ZOOM_STEP)), [])
  const zoomReset = useCallback(() => setZoom(1), [])
  const resetView = useCallback(() => {
    setZoom(1)
    scrollRef.current?.scrollTo({ left: 0, top: 0 })
  }, [])

  // ---- add / delete -----------------------------------------------------------

  const addChild = useCallback(
    (parentId: string | null) => {
      const id = genNodeId()
      const siblings = childrenOf(flat, parentId)
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order), -1)
      const name = parentId ? defaultNames.node : defaultNames.chapter
      commit([...flat, { id, parentId, order: maxOrder + 1, name, covers: [] }])
      setEditingId(id)
      setEditingValue(name)
      setSelectedId(id)
      setSelectedIds([])
    },
    [flat, commit, defaultNames]
  )

  // Smart add: nest under the selected node, else append a new chapter.
  const addNodeSmart = useCallback(() => {
    addChild(selectedId ?? null)
  }, [addChild, selectedId])

  const requestDelete = useCallback((id: string) => setConfirmDeleteId(id), [])
  const cancelDelete = useCallback(() => setConfirmDeleteId(null), [])
  const confirmDelete = useCallback(() => {
    const id = confirmDeleteId
    if (!id) return
    const toRemove = new Set([id])
    let changed = true
    while (changed) {
      changed = false
      flat.forEach(n => {
        if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
          toRemove.add(n.id)
          changed = true
        }
      })
    }
    commit(flat.filter(n => !toRemove.has(n.id)))
    setConfirmDeleteId(null)
    setSelectedId(null)
    setSelectedIds([])
  }, [confirmDeleteId, flat, commit])

  const confirmDeleteName = confirmDeleteId
    ? (flat.find(n => n.id === confirmDeleteId)?.name ?? '')
    : ''

  // ---- drag / marquee ---------------------------------------------------------

  const onNodeMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDrag({ id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false })
  }, [])

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target !== canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setMarquee({ x0: x, y0: y, x1: x, y1: y })
    setSelectedId(null)
    setSelectedIds([])
  }, [])

  // Window-level move/up so a drag/marquee keeps tracking outside the node box.
  useEffect(() => {
    if (!drag && !marquee) return
    const onMove = (e: MouseEvent) => {
      if (drag) {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        const moved = Math.abs(dx) > 4 || Math.abs(dy) > 4
        setDrag({ ...drag, dx, dy, moved })
      } else if (marquee && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        setMarquee({ ...marquee, x1: e.clientX - rect.left, y1: e.clientY - rect.top })
      }
    }
    const onUp = () => {
      if (drag) {
        if (!drag.moved) {
          setSelectedId(drag.id)
          setSelectedIds([])
        } else {
          const next = applyDrop(flat, layout, drag)
          if (next) commit(next)
        }
        setDrag(null)
      } else if (marquee) {
        setSelectedIds(marqueeSelect(flat, layout, marquee))
        setSelectedId(null)
        setMarquee(null)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, marquee, flat, layout, commit])

  // ---- viewport tracking (for the live minimap) -------------------------------

  const syncViewport = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setViewport({
      left: el.scrollLeft,
      top: el.scrollTop,
      w: el.clientWidth,
      h: el.clientHeight,
    })
  }, [])

  useEffect(() => {
    syncViewport()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(syncViewport)
    ro.observe(el)
    return () => ro.disconnect()
  }, [syncViewport, layout.width, layout.height])

  // Recenter the viewport around a point in canvas coordinates (minimap nav).
  const panTo = useCallback((cx: number, cy: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({
      left: cx - el.clientWidth / 2,
      top: cy - el.clientHeight / 2,
    })
  }, [])

  // ---- selection detail -------------------------------------------------------

  const selected = useMemo(() => {
    const node = flat.find(n => n.id === selectedId) ?? null
    const parent = node?.parentId ? (flat.find(n => n.id === node.parentId) ?? null) : null
    const hasChildren = node ? flat.some(n => n.parentId === node.id) : false
    return { node, parent, hasChildren }
  }, [flat, selectedId])

  return {
    // refs
    scrollRef,
    canvasRef,
    // derived
    flat,
    layout,
    edges,
    selected,
    edits,
    viewport,
    countDescendants: (id: string) => countDescendants(flat, id),
    commit,
    // ui state
    selectedId,
    selectedIds,
    editingId,
    editingValue,
    collapsed,
    zoom,
    search,
    drag,
    marquee,
    confirmDeleteId,
    confirmDeleteName,
    // setters / handlers
    setSelectedId,
    setEditingValue,
    setSearch,
    startEditing,
    commitEditing,
    toggleCollapse,
    expandAll,
    collapseAll,
    zoomIn,
    zoomOut,
    zoomReset,
    resetView,
    addChild,
    addNodeSmart,
    requestDelete,
    cancelDelete,
    confirmDelete,
    onNodeMouseDown,
    onCanvasMouseDown,
    syncViewport,
    panTo,
  }
}
