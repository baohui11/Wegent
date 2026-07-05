// SPDX-License-Identifier: Apache-2.0

import { getApiBaseUrl } from '@/lib/runtime-config'
import { apiClient } from './client'
import { bidMockApis } from './bid.mock'
import { getToken } from './user'

export interface BidProject {
  id: number
  title: string
  current_phase: number
  max_phase_reached: number
  status: string
  model_name?: string
  created_at: string
}

export interface TenderScoring {
  id?: string
  weight?: number
  must_keep?: string[]
  target_section?: string
  [k: string]: unknown
}

export interface TenderClause {
  id?: string
  veto?: boolean
  text?: string
  [k: string]: unknown
}

export interface TenderPackage {
  weights?: unknown
  price_formula?: string
  tech_rubric_code?: string
  [k: string]: unknown
}

export interface TenderDoc {
  scoring?: TenderScoring[]
  mandatory_clauses?: TenderClause[]
  qualifications?: unknown
  submission_rules?: unknown
  target_package?: TenderPackage | null
  [k: string]: unknown
}

export interface OutlineNode {
  id?: string
  title?: string
  covers?: string[]
  children?: OutlineNode[]
  [k: string]: unknown
}

export interface OutlineDoc {
  sections?: OutlineNode[]
  volumes?: OutlineNode[]
  [k: string]: unknown
}

export interface UncoveredItem {
  id: string
  text: string
  target_section?: string
}

export interface CoverageReport {
  total: number
  covered: number
  uncovered_scoring: UncoveredItem[]
  uncovered_clauses: UncoveredItem[]
}

export interface OutlineResponse {
  outline: OutlineDoc
  coverage: CoverageReport
}

export interface AttachmentStats {
  chars: number
  pages: number
  tables: number
  images: number
}

export interface AttachmentInfo {
  name: string
  size: number
  stats?: AttachmentStats | null
}

export interface ScoringItem {
  id: string
  item?: string
  weight?: number
  category?: string
  [k: string]: unknown
}

export interface ClauseItem {
  id: string
  text?: string
  veto?: boolean
  [k: string]: unknown
}

export interface SectionGrounding {
  scoring: ScoringItem[]
  clauses: ClauseItem[]
}

export interface GroundingDoc {
  items: Record<string, SectionGrounding>
}

export interface NodeBrief {
  requirements?: string
  emphasis?: string
  wordMin?: string
  wordMax?: string
  needFigure?: string
  priority?: string
}

export interface MaterialEntry {
  id: string
  name: string
  linkedNodeIds: string[]
}

export interface BriefsDoc {
  briefs: Record<string, NodeBrief>
  materials: MaterialEntry[]
}

export interface ExtractedFile {
  name: string
  size: number
  text: string
}

export interface LlmCall {
  id: number
  specialist: string
  label: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  duration_ms: number
  status: string
  created_at: string
  request: string
  response: string
}

export interface DraftStatus {
  total: number
  sections: Record<string, string>
  finished: boolean
  error: string | null
}

export interface DraftSection {
  id: string
  status: string
}

export interface AuditIssue {
  desc: string
  severity: string
  veto?: boolean
  [k: string]: unknown
}

export interface AuditCheck {
  check: string
  ok: boolean
  issues: AuditIssue[]
  [k: string]: unknown
}

export interface AuditReport {
  verdict: string
  summary: {
    total_issues: number
    veto_issues: number
    high_issues: number
    scoring_coverage: string
  }
  checks: AuditCheck[]
}

const realBidApis = {
  listModels: (): Promise<{ items: { name: string }[] }> =>
    apiClient.get<{ items: { name: string }[] }>('/models?page=1&limit=100'),
  createProject: (title: string, model_name?: string): Promise<BidProject> =>
    apiClient.post<BidProject>('/bid/projects', { title, model_name: model_name ?? '' }),
  listProjects: (): Promise<BidProject[]> => apiClient.get<BidProject[]>('/bid/projects'),
  getProject: (id: number): Promise<BidProject> => apiClient.get<BidProject>(`/bid/projects/${id}`),
  deleteProject: (id: number): Promise<{ status: string }> =>
    apiClient.delete<{ status: string }>(`/bid/projects/${id}`),
  parse: (id: number, tenderText: string): Promise<{ status: string }> =>
    apiClient.post<{ status: string }>(`/bid/projects/${id}/parse`, {
      tender_text: tenderText,
    }),
  getParseStage: (id: number): Promise<{ stage: string }> =>
    apiClient.get<{ stage: string }>(`/bid/projects/${id}/parse-stage`),
  getTender: (id: number): Promise<{ tender: TenderDoc }> =>
    apiClient.get<{ tender: TenderDoc }>(`/bid/projects/${id}/tender`),
  buildOutline: (id: number): Promise<OutlineResponse> =>
    apiClient.post<OutlineResponse>(`/bid/projects/${id}/outline`),
  getOutline: (id: number): Promise<OutlineResponse> =>
    apiClient.get<OutlineResponse>(`/bid/projects/${id}/outline`),
  saveOutline: (id: number, outline: OutlineDoc): Promise<OutlineResponse> =>
    apiClient.put<OutlineResponse>(`/bid/projects/${id}/outline`, { outline }),
  getGrounding: (id: number): Promise<GroundingDoc> =>
    apiClient.get<GroundingDoc>(`/bid/projects/${id}/grounding`),
  declarePackage: (id: number, pkg: string): Promise<{ status: string }> =>
    apiClient.post<{ status: string }>(`/bid/projects/${id}/package`, { package: pkg }),
  getKnowledgeBase: (id: number): Promise<{ knowledge_base: Record<string, unknown> }> =>
    apiClient.get(`/bid/projects/${id}/materials/knowledge-base`),
  saveKnowledgeBase: (
    id: number,
    kb: Record<string, unknown>
  ): Promise<{ knowledge_base: Record<string, unknown> }> =>
    apiClient.put(`/bid/projects/${id}/materials/knowledge-base`, { knowledge_base: kb }),
  getQualifications: (id: number): Promise<{ qualifications: Record<string, unknown> }> =>
    apiClient.get(`/bid/projects/${id}/materials/qualifications`),
  saveQualifications: (
    id: number,
    q: Record<string, unknown>
  ): Promise<{ qualifications: Record<string, unknown> }> =>
    apiClient.put(`/bid/projects/${id}/materials/qualifications`, { qualifications: q }),
  getLlmLog: (id: number): Promise<{ items: LlmCall[] }> =>
    apiClient.get<{ items: LlmCall[] }>(`/bid/projects/${id}/llm-log`),
  getBriefs: (id: number): Promise<BriefsDoc> =>
    apiClient.get<BriefsDoc>(`/bid/projects/${id}/materials/briefs`),
  saveBriefs: (id: number, doc: BriefsDoc): Promise<BriefsDoc> =>
    apiClient.put<BriefsDoc>(`/bid/projects/${id}/materials/briefs`, doc),
  listAttachments: (id: number): Promise<{ items: AttachmentInfo[] }> =>
    apiClient.get(`/bid/projects/${id}/materials/attachments`),
  uploadAttachment: async (id: number, file: File): Promise<AttachmentInfo> => {
    const form = new FormData()
    form.append('file', file)
    const token = getToken()
    const res = await fetch(`${getApiBaseUrl()}/bid/projects/${id}/materials/attachments`, {
      method: 'POST',
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
      body: form,
    })
    if (!res.ok) throw new Error(`upload failed: ${res.status}`)
    return res.json()
  },
  extractTenderText: async (file: File): Promise<ExtractedFile> => {
    const form = new FormData()
    form.append('file', file)
    const token = getToken()
    const res = await fetch(`${getApiBaseUrl()}/bid/extract-text`, {
      method: 'POST',
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
      body: form,
    })
    if (!res.ok) {
      let detail = `extract failed: ${res.status}`
      try {
        detail = (await res.json()).detail ?? detail
      } catch {
        /* non-JSON error body */
      }
      throw new Error(detail)
    }
    return res.json()
  },
  completeMaterials: (id: number): Promise<{ status: string }> =>
    apiClient.post(`/bid/projects/${id}/materials/complete`),
  startDraft: (id: number): Promise<{ status: string }> =>
    apiClient.post(`/bid/projects/${id}/draft`),
  getDraftStatus: (id: number): Promise<DraftStatus> =>
    apiClient.get(`/bid/projects/${id}/draft/status`),
  getDraftSections: (id: number): Promise<{ items: DraftSection[] }> =>
    apiClient.get(`/bid/projects/${id}/sections`),
  getSectionContent: (id: number, sectionId: string): Promise<{ id: string; content: string }> =>
    apiClient.get(`/bid/projects/${id}/sections/${sectionId}`),
  redraftSection: (
    id: number,
    sectionId: string,
    instruction?: string
  ): Promise<{ status: string }> =>
    apiClient.post(`/bid/projects/${id}/sections/${sectionId}/redraft`, {
      instruction: instruction ?? null,
    }),
  acceptSection: (id: number, sectionId: string): Promise<{ status: string }> =>
    apiClient.post(`/bid/projects/${id}/sections/${sectionId}/accept`),
  getReviewStatus: (id: number): Promise<{ accepted: Record<string, boolean> }> =>
    apiClient.get(`/bid/projects/${id}/review/status`),
  completeReview: (id: number): Promise<{ status: string }> =>
    apiClient.post(`/bid/projects/${id}/review/complete`),
  runAudit: (id: number): Promise<AuditReport> =>
    apiClient.post<AuditReport>(`/bid/projects/${id}/audit`),
  getAuditReport: (id: number): Promise<AuditReport> =>
    apiClient.get<AuditReport>(`/bid/projects/${id}/audit/report`),
  verifyAudit: (id: number): Promise<AuditReport> =>
    apiClient.post<AuditReport>(`/bid/projects/${id}/audit/verify`),
  finalize: (id: number): Promise<{ status: string }> =>
    apiClient.post<{ status: string }>(`/bid/projects/${id}/finalize`),
  downloadBid: async (id: number): Promise<void> => {
    const token = getToken()
    const res = await fetch(`${getApiBaseUrl()}/bid/projects/${id}/download`, {
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    })
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '投标文件.docx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

// Toggle: run the bid workbench entirely on in-memory mock data (no backend)
// when NEXT_PUBLIC_BID_MOCK is set. Off by default so team/production always
// hit the real API; enable locally, e.g. `NEXT_PUBLIC_BID_MOCK=1 pnpm dev`.
const BID_USE_MOCK =
  process.env.NEXT_PUBLIC_BID_MOCK === '1' || process.env.NEXT_PUBLIC_BID_MOCK === 'true'

export const bidApis = (BID_USE_MOCK ? bidMockApis : realBidApis) as typeof realBidApis

if (BID_USE_MOCK && typeof window !== 'undefined') {
  console.info('[bid] mock mode ON — running on in-memory mock data (NEXT_PUBLIC_BID_MOCK)')
}
