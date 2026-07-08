// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useTranslation } from '@/hooks/useTranslation'

// Table editing controls that appear on HOVER (after a short delay) over a table,
// instead of a caret-anchored bubble that sits on top of the cell while you type.
// `@tiptap/extension-table` ships commands but no UI; this is the less-intrusive
// pattern (Notion/Docs style — controls surface on hover, stay out of the way
// during input). The toolbar floats just above the hovered table.

export interface TableCommand {
  key: string
  icon: string
  labelKey: string
  cmd:
    | 'addColumnBefore'
    | 'addColumnAfter'
    | 'deleteColumn'
    | 'addRowBefore'
    | 'addRowAfter'
    | 'deleteRow'
    | 'toggleHeaderRow'
    | 'deleteTable'
  danger?: boolean
  // Render a divider before this button (visual grouping).
  sep?: boolean
}

export const TABLE_COMMANDS: TableCommand[] = [
  { key: 'col-before', icon: '←', labelKey: 'col_before', cmd: 'addColumnBefore' },
  { key: 'col-after', icon: '→', labelKey: 'col_after', cmd: 'addColumnAfter' },
  { key: 'col-delete', icon: '✕', labelKey: 'col_delete', cmd: 'deleteColumn', danger: true },
  { key: 'row-before', icon: '↑', labelKey: 'row_before', cmd: 'addRowBefore', sep: true },
  { key: 'row-after', icon: '↓', labelKey: 'row_after', cmd: 'addRowAfter' },
  { key: 'row-delete', icon: '⌫', labelKey: 'row_delete', cmd: 'deleteRow', danger: true },
  { key: 'header', icon: '⊤', labelKey: 'toggle_header', cmd: 'toggleHeaderRow', sep: true },
  { key: 'delete', icon: '🗑', labelKey: 'delete_table', cmd: 'deleteTable', danger: true },
]

// The ProseMirror table commands act on the current selection, so move the
// selection into the hovered cell first, then run the command against it.
export function applyTableCommand(editor: Editor, cellPos: number, cmd: TableCommand['cmd']) {
  let chain = editor.chain().focus()
  if (cellPos >= 0) chain = chain.setTextSelection(cellPos)
  const runnable = (chain as unknown as Record<string, () => { run: () => boolean }>)[cmd]
  runnable().run()
}

const SHOW_DELAY = 450
const HIDE_DELAY = 250

interface HoverBox {
  top: number
  left: number
  cellPos: number
}

export function TableHoverControls({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation('bidWorkbench')
  const [box, setBox] = useState<HoverBox | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const view = editor?.view
    if (!view) return
    const dom = view.dom as HTMLElement

    const onMove = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      const cell = el?.closest('td, th') ?? null
      const table = el?.closest('table') ?? null
      if (!cell || !table || !dom.contains(table)) return
      clearTimeout(hideTimer.current)
      clearTimeout(showTimer.current)
      showTimer.current = setTimeout(() => {
        const rect = table.getBoundingClientRect()
        let cellPos = -1
        try {
          cellPos = view.posAtDOM(cell, 0)
        } catch {
          cellPos = -1
        }
        setBox({ top: rect.top, left: rect.left, cellPos })
      }, SHOW_DELAY)
    }
    const onLeave = () => {
      clearTimeout(showTimer.current)
      hideTimer.current = setTimeout(() => setBox(null), HIDE_DELAY)
    }

    dom.addEventListener('mousemove', onMove)
    dom.addEventListener('mouseleave', onLeave)
    return () => {
      dom.removeEventListener('mousemove', onMove)
      dom.removeEventListener('mouseleave', onLeave)
      clearTimeout(showTimer.current)
      clearTimeout(hideTimer.current)
    }
  }, [editor])

  if (!editor || !box) return null

  return (
    <div
      data-testid="bid-table-toolbar"
      onMouseEnter={() => clearTimeout(hideTimer.current)}
      onMouseLeave={() => {
        hideTimer.current = setTimeout(() => setBox(null), HIDE_DELAY)
      }}
      className="flex items-center gap-0.5 rounded-lg px-1.5 py-1"
      style={{
        position: 'fixed',
        top: Math.max(4, box.top - 40),
        left: box.left,
        zIndex: 40,
        background: '#fff',
        border: '1px solid var(--bid-border-2)',
        boxShadow: '0 4px 14px rgba(0,0,0,.12)',
      }}
    >
      {TABLE_COMMANDS.map(c => (
        <span key={c.key} className="flex items-center">
          {c.sep && (
            <span
              className="mx-0.5 h-4 w-px"
              style={{ background: 'var(--bid-border-2)' }}
              aria-hidden
            />
          )}
          <button
            type="button"
            data-testid={`bid-table-${c.key}`}
            title={t(`editor.table.${c.labelKey}`)}
            aria-label={t(`editor.table.${c.labelKey}`)}
            onMouseDown={e => e.preventDefault()}
            onClick={() => applyTableCommand(editor, box.cellPos, c.cmd)}
            className="bubble-btn rounded px-1.5 py-0.5 text-[12px]"
            style={{ color: c.danger ? 'var(--bid-primary)' : 'var(--bid-ink-2)' }}
          >
            {c.icon}
          </button>
        </span>
      ))}
    </div>
  )
}
