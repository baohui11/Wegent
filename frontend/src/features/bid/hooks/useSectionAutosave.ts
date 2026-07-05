// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { bidApis } from '@/apis/bid'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 1500

export function useSectionAutosave({
  projectId,
  sectionId,
  version,
  onSaved,
}: {
  projectId: number
  sectionId: string | null
  version: string
  onSaved: (sectionId: string, version: string) => void
}) {
  const [state, setState] = useState<SaveState>('idle')
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the latest on-disk version so the next save uses the correct
  // optimistic-lock token (CAS). Updated both from props and after each save.
  const versionRef = useRef(version)
  versionRef.current = version

  const doSave = useCallback(async () => {
    if (pending.current === null || !sectionId) return
    const content = pending.current
    pending.current = null
    setState('saving')
    try {
      const r = await bidApis.saveSection(projectId, sectionId, content, versionRef.current)
      versionRef.current = r.version
      onSaved(sectionId, r.version)
      setState('saved')
    } catch {
      setState('error')
    }
  }, [projectId, sectionId, onSaved])

  const queueSave = useCallback(
    (markdown: string) => {
      pending.current = markdown
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void doSave(), DEBOUNCE_MS)
    },
    [doSave]
  )

  // Force any pending save to complete now — used before focus switch / redraft
  // / accept / block regen so disk == editor before downstream line mapping.
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    await doSave()
  }, [doSave])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return { state, queueSave, flush }
}
