// SPDX-License-Identifier: Apache-2.0

import { apiClient } from './client'

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
}
