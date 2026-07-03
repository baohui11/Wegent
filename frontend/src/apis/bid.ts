// SPDX-License-Identifier: Apache-2.0

import { getApiBaseUrl } from '@/lib/runtime-config'
import { apiClient } from './client'
import { getToken } from './user'

export interface BidProject {
  id: number
  title: string
  current_phase: number
  max_phase_reached: number
  status: string
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

export interface CoverageReport {
  total: number
  covered: number
  uncovered_scoring: string[]
  uncovered_clauses: string[]
}

export interface OutlineResponse {
  outline: OutlineDoc
  coverage: CoverageReport
}

export interface AttachmentInfo {
  name: string
  size: number
}

export const bidApis = {
  createProject: (title: string): Promise<BidProject> =>
    apiClient.post<BidProject>('/bid/projects', { title }),
  listProjects: (): Promise<BidProject[]> => apiClient.get<BidProject[]>('/bid/projects'),
  getProject: (id: number): Promise<BidProject> => apiClient.get<BidProject>(`/bid/projects/${id}`),
  parse: (id: number, tenderText: string): Promise<{ status: string }> =>
    apiClient.post<{ status: string }>(`/bid/projects/${id}/parse`, {
      tender_text: tenderText,
    }),
  getTender: (id: number): Promise<{ tender: TenderDoc }> =>
    apiClient.get<{ tender: TenderDoc }>(`/bid/projects/${id}/tender`),
  buildOutline: (id: number): Promise<OutlineResponse> =>
    apiClient.post<OutlineResponse>(`/bid/projects/${id}/outline`),
  getOutline: (id: number): Promise<OutlineResponse> =>
    apiClient.get<OutlineResponse>(`/bid/projects/${id}/outline`),
  saveOutline: (id: number, outline: OutlineDoc): Promise<OutlineResponse> =>
    apiClient.put<OutlineResponse>(`/bid/projects/${id}/outline`, { outline }),
  getCoverage: (id: number): Promise<CoverageReport> =>
    apiClient.get<CoverageReport>(`/bid/projects/${id}/coverage`),
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
  completeMaterials: (id: number): Promise<{ status: string }> =>
    apiClient.post(`/bid/projects/${id}/materials/complete`),
}
