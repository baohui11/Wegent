// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react'
import { bidApis, type CoverageReport, type OutlineDoc, type TenderDoc } from '@/apis/bid'

type Phase =
  | 'idle'
  | 'creating'
  | 'parsing'
  | 'ready'
  | 'outline_building'
  | 'outline_ready'
  | 'materials'
  | 'materials_done'
  | 'drafting'
  | 'error'

export function useBidProject() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [tender, setTender] = useState<TenderDoc | null>(null)
  const [outline, setOutline] = useState<OutlineDoc | null>(null)
  const [coverage, setCoverage] = useState<CoverageReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startFromText = useCallback(async (text: string, pkg?: string) => {
    setError(null)
    try {
      setPhase('creating')
      const project = await bidApis.createProject('标书项目')
      setProjectId(project.id)
      if (pkg) await bidApis.declarePackage(project.id, pkg)
      setPhase('parsing')
      await bidApis.parse(project.id, text)
      const res = await bidApis.getTender(project.id)
      setTender(res.tender)
      setPhase('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
      setPhase('error')
    }
  }, [])

  const buildOutline = useCallback(async () => {
    if (projectId == null) return
    setError(null)
    try {
      setPhase('outline_building')
      const { outline, coverage } = await bidApis.buildOutline(projectId)
      setOutline(outline)
      setCoverage(coverage)
      setPhase('outline_ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
      setPhase('error')
    }
  }, [projectId])

  const saveOutline = useCallback(
    async (edited: OutlineDoc) => {
      if (projectId == null) return
      const { outline, coverage } = await bidApis.saveOutline(projectId, edited)
      setOutline(outline)
      setCoverage(coverage)
    },
    [projectId]
  )

  const reset = useCallback(() => {
    setPhase('idle')
    setProjectId(null)
    setTender(null)
    setOutline(null)
    setCoverage(null)
    setError(null)
  }, [])

  const enterMaterials = useCallback(() => setPhase('materials'), [])

  const completeMaterials = useCallback(async () => {
    if (projectId == null) return
    await bidApis.completeMaterials(projectId)
    setPhase('materials_done')
  }, [projectId])

  const startDrafting = useCallback(async () => {
    if (projectId == null) return
    await bidApis.startDraft(projectId)
    setPhase('drafting')
  }, [projectId])

  return {
    phase,
    projectId,
    tender,
    outline,
    coverage,
    error,
    startFromText,
    buildOutline,
    saveOutline,
    reset,
    enterMaterials,
    completeMaterials,
    startDrafting,
  }
}
