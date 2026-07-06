// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { bidApis } from '@/apis/bid'
import { serializeSection } from '../canvas/serializeSection'

export type SectionSaveState = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 1500

// Meta key stamped on programmatic transactions (initial load, version
// write-back after a save) so the update handler can skip them. Without this,
// merely entering Edit mode (which setContent's the doc) would PUT every
// section — the exact regression Task 5 guards against.
export const BID_SEED_META = 'bidSeed'

// Walk the top-level bidSection nodes; return [sectionId, node, version] per
// section so callers can address per-section state without re-walking.
function sections(editor: Editor): Array<{ sid: string; node: ProseMirrorNode; version: string }> {
  const out: Array<{ sid: string; node: ProseMirrorNode; version: string }> = []
  editor.state.doc.forEach(n => {
    const node = n as ProseMirrorNode
    if (node.type.name === 'bidSection') {
      out.push({
        sid: String(node.attrs.sectionId ?? ''),
        node,
        version: String(node.attrs.version ?? ''),
      })
    }
  })
  return out
}

// Document-level autosave that persists each edited section independently via
// its own CAS version (the backend is strictly per-section). On `editor.update`
// it serializes every section and queues a save ONLY for the ones whose body
// markdown changed vs the last snapshot; transactions stamped with the
// `bidSeed` meta (programmatic load / version write-back) are skipped entirely.
// After a save the fresh CAS token is written back onto the section's `version`
// attr under a `bidSeed` transaction so it never re-triggers a save.
export function useDocumentAutosave({
  projectId,
  editor,
  onSaved,
}: {
  projectId: number
  editor: Editor | null
  onSaved: (sectionId: string, version: string) => void
}) {
  const [saveState, setSaveState] = useState<Record<string, SectionSaveState>>({})
  // Last persisted body markdown per section — the dirty-detection baseline.
  const snapshots = useRef<Record<string, string>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const saveOne = useCallback(
    async (sid: string): Promise<string> => {
      if (!editor) return ''
      const entry = sections(editor).find(s => s.sid === sid)
      if (!entry) return snapshots.current[sid] ?? ''
      const md = serializeSection(editor, entry.node)
      // No-op edit: body unchanged vs the last persisted snapshot.
      if (md === snapshots.current[sid]) return entry.version
      setSaveState(s => ({ ...s, [sid]: 'saving' }))
      try {
        const r = await bidApis.saveSection(projectId, sid, md, entry.version)
        snapshots.current[sid] = md
        // Write the fresh CAS token back onto the section's version attr. The
        // transaction is stamped bidSeed so it does NOT re-trigger a save.
        editor.commands.command(({ tr, state, dispatch }) => {
          state.doc.forEach((n, pos) => {
            const node = n as ProseMirrorNode
            if (node.type.name === 'bidSection' && String(node.attrs.sectionId) === sid) {
              tr.setNodeAttribute(pos, 'version', r.version)
            }
          })
          tr.setMeta(BID_SEED_META, true)
          dispatch?.(tr)
          return true
        })
        onSaved(sid, r.version)
        setSaveState(s => ({ ...s, [sid]: 'saved' }))
        return r.version
      } catch {
        setSaveState(s => ({ ...s, [sid]: 'error' }))
        return entry.version
      }
    },
    [editor, projectId, onSaved]
  )

  const flushSection = useCallback(
    async (sid: string): Promise<string> => {
      if (timers.current[sid]) {
        clearTimeout(timers.current[sid])
        delete timers.current[sid]
      }
      return saveOne(sid)
    },
    [saveOne]
  )

  useEffect(() => {
    if (!editor) return
    const handler = ({
      transaction,
    }: {
      transaction: { getMeta: (k: string) => unknown; docChanged: boolean }
    }) => {
      // Programmatic re-seed (load / version write-back): never autosave.
      if (transaction.getMeta(BID_SEED_META) || !transaction.docChanged) return
      // Serialize every section; queue a save only for the dirty ones. This is
      // cheap (string compare) and only the changed sections actually PUT.
      for (const { sid, node } of sections(editor)) {
        if (serializeSection(editor, node) === snapshots.current[sid]) continue
        if (timers.current[sid]) clearTimeout(timers.current[sid])
        timers.current[sid] = setTimeout(() => {
          void saveOne(sid)
        }, DEBOUNCE_MS)
      }
    }
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [editor, saveOne])

  // Seed the per-section snapshots once the doc is first populated so the
  // initial content is not treated as "changed" (prevents the mount-time PUT).
  // Call this from the editor-assembly layer after setContent on load.
  const seedSnapshots = useCallback(() => {
    if (!editor) return
    for (const { sid, node } of sections(editor)) {
      snapshots.current[sid] = serializeSection(editor, node)
    }
  }, [editor])

  // Cancel pending timers on unmount.
  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) clearTimeout(t)
      timers.current = {}
    },
    []
  )

  return { saveState, flushSection, seedSnapshots }
}
