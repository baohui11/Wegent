// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from '@/hooks/useTranslation'
import type { OutlineNode } from '@/apis/bid'

interface Props {
  nodes: OutlineNode[]
  onChange: (nodes: OutlineNode[]) => void
}

export function OutlineTree({ nodes, onChange }: Props) {
  const { t } = useTranslation('bidWorkbench')
  const setNode = (i: number, patch: Partial<OutlineNode>) =>
    onChange(nodes.map((n, j) => (j === i ? { ...n, ...patch } : n)))
  const removeNode = (i: number) => onChange(nodes.filter((_, j) => j !== i))
  const addChild = (i: number) =>
    setNode(i, {
      children: [...(nodes[i].children ?? []), { title: t('phase2.new_node'), covers: [] }],
    })

  return (
    <div className="flex flex-col gap-2">
      {nodes.map((n, i) => (
        <div key={i} className="rounded-md border border-border p-2">
          <div className="flex items-center gap-2">
            <input
              value={n.title ?? ''}
              onChange={e => setNode(i, { title: e.target.value })}
              data-testid="outline-node-title"
              className="flex-1 rounded border border-border px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => addChild(i)}
              data-testid="outline-node-add"
              className="text-xs text-primary"
            >
              {t('phase2.add_child')}
            </button>
            <button
              type="button"
              onClick={() => removeNode(i)}
              data-testid="outline-node-delete"
              className="text-xs text-error"
            >
              {t('phase2.delete')}
            </button>
          </div>
          <input
            value={(n.covers ?? []).join(', ')}
            onChange={e =>
              setNode(i, {
                covers: e.target.value
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={t('phase2.covers')}
            data-testid="outline-node-covers"
            className="mt-1 w-full rounded border border-border px-2 py-1 text-xs text-text-secondary"
          />
          {n.children && n.children.length > 0 && (
            <div className="ml-4 mt-2 border-l border-border pl-3">
              <OutlineTree nodes={n.children} onChange={kids => setNode(i, { children: kids })} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
