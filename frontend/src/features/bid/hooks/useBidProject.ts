// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react'
import {
  bidApis,
  type BidProject,
  type CoverageReport,
  type OutlineDoc,
  type TenderDoc,
} from '@/apis/bid'

export type Phase =
  | 'idle'
  | 'import'
  | 'creating'
  | 'parsing'
  | 'ready'
  | 'outline_building'
  | 'outline_ready'
  | 'materials'
  | 'drafting'
  | 'audit'
  | 'finalizing'
  | 'done'
  | 'error'

// Maps a workbench phase to the four-stage stepper index.
export function phaseToStage(phase: Phase | string): number {
  switch (phase) {
    case 'materials':
      return 2
    case 'drafting':
      return 3
    case 'audit':
    case 'finalizing':
    case 'done':
      return 4
    default:
      return 1
  }
}

export function useBidProject() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [tender, setTender] = useState<TenderDoc | null>(null)
  const [outline, setOutline] = useState<OutlineDoc | null>(null)
  const [coverage, setCoverage] = useState<CoverageReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pollUntilParsed = useCallback(async (id: number) => {
    for (let i = 0; i < 240; i++) {
      const p = await bidApis.getProject(id)
      if (p.status === 'parse_failed') {
        throw new Error('拆标失败，请检查招标文件后重试')
      }
      if (p.status === 'parsed' || p.current_phase >= 2) return
      await new Promise(r => setTimeout(r, 3000))
    }
    throw new Error('拆标超时，请稍后重试')
  }, [])

  const parseExisting = useCallback(
    async (id: number, text: string, pkg?: string) => {
      setError(null)
      try {
        if (pkg) await bidApis.declarePackage(id, pkg)
        setPhase('parsing')
        await bidApis.parse(id, text)
        await pollUntilParsed(id)
        const res = await bidApis.getTender(id)
        setTender(res.tender)
        // Design: parsing flows straight into the populated Stage 1 canvas —
        // build the outline automatically (no intermediate scoring table).
        const built = await bidApis.buildOutline(id)
        setOutline(built.outline)
        setCoverage(built.coverage)
        setPhase('outline_ready')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown')
        setPhase('error')
      }
    },
    [pollUntilParsed]
  )

  const open = useCallback(
    async (project: BidProject) => {
      setError(null)
      setProjectId(project.id)
      const cp = project.current_phase
      const st = project.status
      try {
        if (cp <= 1) {
          if (st === 'parsing') {
            setPhase('parsing')
            await pollUntilParsed(project.id)
            const res = await bidApis.getTender(project.id)
            setTender(res.tender)
            const built = await bidApis.buildOutline(project.id)
            setOutline(built.outline)
            setCoverage(built.coverage)
            setPhase('outline_ready')
            return
          }
          setPhase('import')
          return
        }
        if (cp === 2) {
          const res = await bidApis.getTender(project.id)
          setTender(res.tender)
          try {
            const o = await bidApis.getOutline(project.id)
            setOutline(o.outline)
            setCoverage(o.coverage)
            setPhase('outline_ready')
          } catch {
            // Parsed but no outline yet — build it (shows the canvas in its
            // building state), matching the new-project flow.
            setPhase('outline_building')
            const built = await bidApis.buildOutline(project.id)
            setOutline(built.outline)
            setCoverage(built.coverage)
            setPhase('outline_ready')
          }
          return
        }
        // Stages 2-5 render the outline tree (materials/drafting/review) or need
        // it for cross-stage "locate", so load it before entering those phases.
        if (cp >= 3 && cp <= 6) {
          try {
            const o = await bidApis.getOutline(project.id)
            setOutline(o.outline)
            setCoverage(o.coverage)
          } catch {
            // No stored outline yet — the screens degrade to an empty tree.
          }
        }
        if (cp === 3) {
          setPhase('materials')
          return
        }
        if (cp === 4) {
          setPhase(st === 'drafting' ? 'drafting' : 'materials')
          return
        }
        if (cp === 5) {
          // Stage-4 (backend review) is merged into the generate-refine phase.
          setPhase('drafting')
          return
        }
        if (cp === 6) {
          setPhase('audit')
          return
        }
        setPhase('done')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown')
        setPhase('error')
      }
    },
    [pollUntilParsed]
  )

  const startFromText = useCallback(
    async (text: string, name?: string, pkg?: string, model?: string) => {
      setError(null)
      let id: number
      try {
        setPhase('creating')
        // Manual name when provided; the default placeholder lets the backend
        // derive the title from the parsed tender (smart naming).
        const project = await bidApis.createProject(
          name?.trim() || '标书项目',
          model?.trim() || undefined
        )
        setProjectId(project.id)
        id = project.id
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown')
        setPhase('error')
        return
      }
      await parseExisting(id, text, pkg)
    },
    [parseExisting]
  )

  const startNew = useCallback(() => {
    setProjectId(null)
    setTender(null)
    setOutline(null)
    setCoverage(null)
    setError(null)
    setPhase('import')
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

  // Confirming materials completes it and kicks off drafting in one step,
  // landing straight on Stage 3 (no intermediate interstitial screen).
  const completeMaterials = useCallback(async () => {
    if (projectId == null) return
    await bidApis.completeMaterials(projectId)
    await bidApis.startDraft(projectId)
    setPhase('drafting')
  }, [projectId])

  const startDrafting = useCallback(async () => {
    if (projectId == null) return
    await bidApis.startDraft(projectId)
    setPhase('drafting')
  }, [projectId])

  // Confirming the review advances straight to Stage 5 (check & export).
  const completeReview = useCallback(async () => {
    if (projectId == null) return
    await bidApis.completeReview(projectId)
    setPhase('audit')
  }, [projectId])

  const enterAudit = useCallback(() => setPhase('audit'), [])

  // Backward navigation to an already-reached stage via the stepper.
  const goStage = useCallback((stage: number) => {
    const target: Record<number, Phase> = {
      1: 'outline_ready',
      2: 'materials',
      3: 'drafting',
      4: 'audit',
    }
    const next = target[stage]
    if (next) setPhase(next)
  }, [])

  const finalizeBid = useCallback(async () => {
    if (projectId == null) return
    setError(null)
    try {
      setPhase('finalizing')
      await bidApis.finalize(projectId)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
      setPhase('error')
    }
  }, [projectId])

  return {
    phase,
    projectId,
    tender,
    outline,
    coverage,
    error,
    startFromText,
    parseExisting,
    startNew,
    open,
    buildOutline,
    saveOutline,
    reset,
    enterMaterials,
    completeMaterials,
    startDrafting,
    completeReview,
    enterAudit,
    finalizeBid,
    goStage,
  }
}
