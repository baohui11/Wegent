// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react'
import {
  bidApis,
  type BidProject,
  type CoverageReport,
  type OutlineDoc,
  type TenderDoc,
} from '@/apis/bid'

type Phase =
  | 'idle'
  | 'import'
  | 'creating'
  | 'parsing'
  | 'ready'
  | 'outline_building'
  | 'outline_ready'
  | 'materials'
  | 'materials_done'
  | 'drafting'
  | 'review'
  | 'review_done'
  | 'audit'
  | 'finalizing'
  | 'done'
  | 'error'

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
        setPhase('ready')
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
            setPhase('ready')
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
            setPhase('ready')
          }
          return
        }
        if (cp === 3) {
          setPhase('materials')
          return
        }
        if (cp === 4) {
          setPhase(st === 'drafting' ? 'drafting' : 'materials_done')
          return
        }
        if (cp === 5) {
          setPhase('review')
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
    async (text: string, pkg?: string) => {
      setError(null)
      let id: number
      try {
        setPhase('creating')
        const project = await bidApis.createProject('标书项目')
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

  const enterReview = useCallback(() => setPhase('review'), [])

  const completeReview = useCallback(async () => {
    if (projectId == null) return
    await bidApis.completeReview(projectId)
    setPhase('review_done')
  }, [projectId])

  const enterAudit = useCallback(() => setPhase('audit'), [])

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
    enterReview,
    completeReview,
    enterAudit,
    finalizeBid,
  }
}
