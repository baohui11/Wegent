// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { useTranslation } from '@/hooks/useTranslation'

// The block handle's two menus (subproject 🅐 + block-actions follow-up):
//   +  → insert a NEW block after the hovered block (choose a type)
//   ⠿  → drag the block, OR click to open block actions (insert above/below,
//        duplicate, delete)
// The `+` inserts, it never transforms the current block (that is the selection
// bubble's job). `⠿` stays draggable — a plain click (no drag) opens its menu.
// Both menus are controlled by BidDocumentEditor so the drag handle can freeze
// while one is open and collapse it when the hovered block changes.

export interface BlockTarget {
  node: ProseMirrorNode
  pos: number
}

export type OpenMenu = 'insert' | 'actions' | null

// ---- Insert menu (the `+`): insert a new block after the target -------------

interface BlockInsertItem {
  key: string
  labelKey: string
  hint: string
  icon: string
  // Block JSON inserted after the target. null for items with a dedicated
  // command (table/image use their extension helpers, not raw JSON).
  json: object | null
}

export const BLOCK_INSERT_ITEMS: BlockInsertItem[] = [
  { key: 'paragraph', labelKey: 'paragraph', hint: '', icon: '¶', json: { type: 'paragraph' } },
  {
    key: 'heading2',
    labelKey: 'heading2',
    hint: '##',
    icon: 'H2',
    json: { type: 'heading', attrs: { level: 2 } },
  },
  {
    key: 'heading3',
    labelKey: 'heading3',
    hint: '###',
    icon: 'H3',
    json: { type: 'heading', attrs: { level: 3 } },
  },
  {
    key: 'bullet_list',
    labelKey: 'bullet_list',
    hint: '-',
    icon: '•',
    json: { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
  },
  {
    key: 'ordered_list',
    labelKey: 'ordered_list',
    hint: '1.',
    icon: '1.',
    json: {
      type: 'orderedList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    },
  },
  { key: 'table', labelKey: 'table', hint: '', icon: '▦', json: null },
  { key: 'image', labelKey: 'image', hint: '', icon: '🖼', json: null },
  { key: 'divider', labelKey: 'divider', hint: '---', icon: '—', json: { type: 'horizontalRule' } },
  {
    key: 'code_block',
    labelKey: 'code_block',
    hint: '```',
    icon: '</>',
    json: { type: 'codeBlock' },
  },
]

// Insert content at `at`, then drop the caret into the new block.
function insertAt(editor: Editor, at: number, json: object) {
  editor
    .chain()
    .insertContentAt(at, json)
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)))
      return true
    })
    .focus()
    .run()
}

function insertBlockAfter(
  editor: Editor,
  target: BlockTarget,
  item: BlockInsertItem,
  promptImageSrc: () => string
) {
  const at = target.pos + target.node.nodeSize
  if (item.key === 'table') {
    editor.chain().focus(at).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    return
  }
  if (item.key === 'image') {
    const src = promptImageSrc().trim()
    if (src) editor.chain().focus(at).setImage({ src }).run()
    return
  }
  insertAt(editor, at, item.json as object)
}

// ---- Actions menu (the `⠿`): operate on the hovered block -------------------

interface BlockAction {
  key: string
  labelKey: string
  icon: string
  danger?: boolean
  run: (editor: Editor, target: BlockTarget) => void
}

const BLOCK_ACTIONS: BlockAction[] = [
  {
    key: 'insert_above',
    labelKey: 'insert_above',
    icon: '↑',
    run: (e, t) => insertAt(e, t.pos, { type: 'paragraph' }),
  },
  {
    key: 'insert_below',
    labelKey: 'insert_below',
    icon: '↓',
    run: (e, t) => insertAt(e, t.pos + t.node.nodeSize, { type: 'paragraph' }),
  },
  {
    key: 'duplicate',
    labelKey: 'duplicate',
    icon: '⧉',
    run: (e, t) =>
      e
        .chain()
        .insertContentAt(t.pos + t.node.nodeSize, t.node.toJSON())
        .focus()
        .run(),
  },
  {
    key: 'delete',
    labelKey: 'delete',
    icon: '🗑',
    danger: true,
    run: (e, t) =>
      e
        .chain()
        .deleteRange({ from: t.pos, to: t.pos + t.node.nodeSize })
        .focus()
        .run(),
  },
]

const BLOCK_TYPE_KEYS = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'table',
  'codeBlock',
  'blockquote',
  'horizontalRule',
  'image',
])

// ---- Component --------------------------------------------------------------

interface BlockInsertMenuProps {
  editor: Editor
  target: BlockTarget | null
  openMenu: OpenMenu
  onOpenMenuChange: (menu: OpenMenu) => void
}

// Menu height budget for the flip-up decision (worst case: the insert menu).
const MENU_HEIGHT = 340

export function BlockInsertMenu({
  editor,
  target,
  openMenu,
  onOpenMenuChange,
}: BlockInsertMenuProps) {
  const { t } = useTranslation('bidWorkbench')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [flipUp, setFlipUp] = useState(false)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) {
        onOpenMenuChange(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenMenuChange(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu, onOpenMenuChange])

  const openAt = (menu: Exclude<OpenMenu, null>) => {
    const next = openMenu === menu ? null : menu
    if (next && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect()
      setFlipUp(window.innerHeight - rect.bottom < MENU_HEIGHT)
    }
    onOpenMenuChange(next)
  }

  const runInsert = (item: BlockInsertItem) => {
    if (target) {
      insertBlockAfter(
        editor,
        target,
        item,
        () => window.prompt(t('editor.insert.image_prompt')) ?? ''
      )
    }
    onOpenMenuChange(null)
  }

  const runAction = (action: BlockAction) => {
    if (target) action.run(editor, target)
    onOpenMenuChange(null)
  }

  const noDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const typeName = target?.node.type.name ?? ''
  const typeLabel = BLOCK_TYPE_KEYS.has(typeName)
    ? t(`editor.block_type.${typeName}`)
    : t('editor.block_type.block')
  const menuClass = `bid-block-insert-menu${flipUp ? ' bid-block-insert-menu-up' : ''}`

  return (
    <div
      ref={rootRef}
      className="bid-block-insert"
      data-testid="bid-drag-handle-inner"
      data-node-type={typeName}
    >
      {/* + inserts a new block; must not itself start a drag. */}
      <button
        type="button"
        data-testid="bid-block-insert-trigger"
        title={t('editor.insert.menu_label')}
        aria-haspopup="menu"
        aria-expanded={openMenu === 'insert'}
        onPointerDown={e => e.stopPropagation()}
        onDragStart={noDrag}
        onClick={() => openAt('insert')}
      >
        +
      </button>
      {/* ⠿ stays draggable (no dragstart guard); a click opens block actions. */}
      <button
        type="button"
        data-testid="bid-block-actions-trigger"
        className="bid-block-insert-grip"
        title={t('editor.actions.menu_label')}
        aria-haspopup="menu"
        aria-expanded={openMenu === 'actions'}
        onClick={() => openAt('actions')}
      >
        ⠿
      </button>

      {openMenu === 'insert' && (
        <div
          role="menu"
          className={menuClass}
          data-testid="bid-block-insert-menu"
          onDragStart={noDrag}
        >
          {BLOCK_INSERT_ITEMS.map(item => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              data-testid={`bid-block-insert-${item.key}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => runInsert(item)}
              className="bid-block-insert-item"
            >
              <span className="bid-block-insert-item-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="bid-block-insert-item-label">
                {t(`editor.insert.${item.labelKey}`)}
              </span>
              {item.hint && (
                <span className="bid-block-insert-item-hint" aria-hidden>
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {openMenu === 'actions' && (
        <div
          role="menu"
          className={menuClass}
          data-testid="bid-block-actions-menu"
          onDragStart={noDrag}
        >
          <div className="bid-block-menu-header">{typeLabel}</div>
          {BLOCK_ACTIONS.map(action => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              data-testid={`bid-block-action-${action.key}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => runAction(action)}
              className={`bid-block-insert-item${action.danger ? ' bid-block-insert-item-danger' : ''}`}
            >
              <span className="bid-block-insert-item-icon" aria-hidden>
                {action.icon}
              </span>
              <span className="bid-block-insert-item-label">
                {t(`editor.actions.${action.labelKey}`)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
