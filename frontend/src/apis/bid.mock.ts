// SPDX-License-Identifier: Apache-2.0
//
// In-memory mock backend for the bid workbench, used for pure-frontend design
// work without a live backend. Activated by NEXT_PUBLIC_BID_MOCK=1 (see bid.ts).
// It mirrors the `bidApis` surface and simulates the time-based flows (parse,
// drafting) so polling screens advance on their own.

import type {
  AttachmentInfo,
  AuditReport,
  BidProject,
  BriefsDoc,
  ClauseItem,
  CoverageReport,
  DraftSection,
  DraftStatus,
  ExtractedFile,
  GroundingDoc,
  LlmCall,
  NodeBrief,
  OutlineDoc,
  OutlineNode,
  OutlineResponse,
  OutlineStage3Response,
  ScoringItem,
  TenderDoc,
} from './bid'

// --- timing knobs (kept short so the demo flows briskly) ---
const PARSE_MS = 4500
const DRAFT_PER_SECTION_MS = 1800

const delay = <T>(value: T, ms = 240): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms))

// --- shared mock content (one realistic tender reused across projects) ---
const MOCK_TENDER: TenderDoc = {
  project: {
    name: '智慧园区智能化建设项目',
    code: 'ZFCG-2026-0731',
    budget: '8,000,000',
    deadline: '2026-09-30 17:00',
  },
  scoring: [
    {
      id: 'T1',
      weight: 20,
      category: '技术',
      item: '总体技术方案的完整性与先进性',
      target_section: '第一章 总体技术方案',
    },
    {
      id: 'T2',
      weight: 15,
      category: '技术',
      item: '数据安全与等级保护方案',
      target_section: '第二章 数据安全',
    },
    {
      id: 'T3',
      weight: 15,
      category: '技术',
      item: '项目实施与进度管理方案',
      target_section: '第三章 项目实施',
    },
    {
      id: 'T4',
      weight: 10,
      category: '技术',
      item: '运维与售后服务方案',
      target_section: '第四章 运维服务',
    },
    {
      id: 'T5',
      weight: 10,
      category: '技术',
      item: '类似项目业绩',
      target_section: '第五章 项目业绩',
    },
    {
      id: 'B1',
      weight: 30,
      category: '价格',
      item: '投标报价（低价优先法）',
      target_section: '报价分册',
    },
  ],
  mandatory_clauses: [
    { id: 'M1', veto: true, text: '投标有效期不少于 90 天，不满足的作废标处理。' },
    { id: 'M2', veto: true, text: '投标保证金人民币 16 万元，未按时足额缴纳的作废标处理。' },
    {
      id: 'M3',
      veto: true,
      text: '必须对本项目全部技术需求作出实质性响应，出现负偏离核心指标的作废标处理。',
    },
    {
      id: 'M4',
      veto: true,
      text: '投标文件须由法定代表人或授权代表签字并加盖公章，否则作废标处理。',
    },
  ],
  qualifications: {
    company: '华信数智科技有限公司',
    items: [
      { id: 'Q1', name: '营业执照', required: true },
      { id: 'Q2', name: 'ISO9001 质量管理体系认证', required: true },
      { id: 'Q3', name: 'CMMI3 及以上评估证书', required: true },
      { id: 'Q4', name: '近三年财务审计报告', required: true },
    ],
  },
  submission_rules: {
    copies: '正本一份、副本四份',
    format: '技术标与商务标分册装订',
    extra: '须提供偏离表与响应索引表',
  },
  target_package: { code: '单一标包', price_formula: '低价优先法', tech_rubric_code: 'T' },
}

const leaf = (id: string, title: string, covers?: string[]): OutlineDoc =>
  ({ id, title, ...(covers ? { covers } : {}) }) as OutlineDoc

const MOCK_OUTLINE: OutlineDoc = {
  sections: [
    {
      id: 's1',
      title: '第一章 总体技术方案',
      covers: ['T1'],
      children: [
        leaf('s1.1', '系统总体架构设计', ['T1']),
        leaf('s1.2', '关键技术选型'),
        leaf('s1.3', '部署与集成方案'),
      ],
    },
    {
      id: 's2',
      title: '第二章 数据安全与等级保护',
      covers: ['T2'],
      children: [leaf('s2.1', '等保三级合规方案', ['T2']), leaf('s2.2', '数据加密与访问控制')],
    },
    {
      id: 's3',
      title: '第三章 项目实施与进度管理',
      covers: ['T3'],
      children: [leaf('s3.1', 'WBS 分解与里程碑', ['T3']), leaf('s3.2', '质量与风险管理')],
    },
    {
      id: 's4',
      title: '第四章 运维与售后服务',
      covers: ['T4'],
      children: [leaf('s4.1', '7×24 运维响应机制', ['T4'])],
    },
    {
      id: 's5',
      title: '第五章 类似项目业绩',
      covers: ['T5'],
      children: [leaf('s5.1', '政务信息化项目业绩', ['T5'])],
    },
  ],
  volumes: [
    { id: 'v1', title: '商务分册' },
    { id: 'v2', title: '资格证明分册' },
    { id: 'v3', title: '报价分册' },
  ],
}

const MOCK_COVERAGE: CoverageReport = {
  total: 6,
  covered: 5,
  uncovered_scoring: [{ id: 'B1', text: '投标报价（低价优先法）', target_section: '报价分册' }],
  uncovered_clauses: [],
}

// Derive per-node grounding from the mock outline's `covers` ∩ mock tender
// (scoring items + veto clauses). Mirrors the backend `_grounding_items` so the
// mock mode renders the same per-section covered items as a live backend.
const MOCK_GROUNDING: GroundingDoc = (() => {
  const scoring: ScoringItem[] = (MOCK_TENDER.scoring ?? []).map(s => ({ ...s, id: String(s.id) }))
  const clauses: ClauseItem[] = (MOCK_TENDER.mandatory_clauses ?? [])
    .filter(c => c.veto)
    .map(c => ({ ...c, id: String(c.id), veto: true }))
  const scoringById = new Map(scoring.map(s => [s.id, s]))
  const clauseById = new Map(clauses.map(c => [c.id, c]))
  const items: GroundingDoc['items'] = {}
  const walk = (node: OutlineNode | undefined): void => {
    if (!node) return
    const covers = (node.covers ?? []).map(String)
    if (covers.length) {
      const s = covers.map(id => scoringById.get(id)).filter((x): x is ScoringItem => !!x)
      const c = covers.map(id => clauseById.get(id)).filter((x): x is ClauseItem => !!x)
      if (s.length || c.length) {
        items[String(node.id)] = { scoring: s, clauses: c }
      }
    }
    for (const child of node.children ?? []) walk(child)
  }
  for (const sec of MOCK_OUTLINE.sections ?? []) walk(sec)
  return { items }
})()

// Draftable/reviewable sections (chapter level) with mock body content.
const SECTION_IDS = ['s1', 's2', 's3', 's4', 's5']
const SECTION_TITLE: Record<string, string> = {
  s1: '第一章 总体技术方案',
  s2: '第二章 数据安全与等级保护',
  s3: '第三章 项目实施与进度管理',
  s4: '第四章 运维与售后服务',
  s5: '第五章 类似项目业绩',
}
const SECTION_CONTENT: Record<string, string> = {
  // Title-less bodies: the section heading now lives only in the outline and
  // is injected by the NodeView / assembler (single-document foundation §6 /
  // spike Conclusion B). Bodies start with the first paragraph of substance.
  s1: `本项目采用"云-边-端"三层协同架构，构建统一的智慧园区数字底座。总体架构自下而上分为感知层、网络层、平台层与应用层，各层之间通过标准化接口解耦，保证系统的先进性、开放性与可扩展性。\n\n### 1.1 系统总体架构\n平台层基于微服务架构设计，采用容器化部署与服务网格治理，支持弹性伸缩与灰度发布。\n\n### 1.2 关键技术选型\n- 应用框架：Spring Cloud 微服务体系\n- 数据存储：分布式关系库 + 时序库 + 对象存储\n- 物联网接入：MQTT / CoAP 双协议网关`,
  s2: `本方案严格响应网络安全等级保护三级（等保 2.0）要求，从物理、网络、主机、应用、数据五个维度构建纵深防御体系。\n\n全链路数据采用国密 SM4 加密传输与存储，结合基于角色的访问控制（RBAC）与最小权限原则，确保敏感数据不泄露、不篡改。`,
  s3: `项目实施划分为需求调研、设计开发、集成测试、试运行、验收交付五个阶段，总工期 180 日历天。\n\n通过 WBS 工作分解结构明确各阶段交付物与里程碑，采用敏捷迭代与周例会机制动态跟踪进度与风险。`,
  s4: `我方承诺提供 7×24 小时运维响应服务，一般故障 30 分钟内响应、2 小时内到场，重大故障启动应急预案并 4 小时内恢复。\n\n配备专职驻场运维团队，建立分级服务台与知识库，保障系统长期稳定运行。`,
  s5: `近三年我方承建并成功验收多个 500 万元以上政务信息化项目，具备丰富的智慧园区与数据中心建设经验，相关项目均获得客户高度评价。`,
}

// Mutable overlay so that human edits (saveSection) are reflected on the next
// getSectionContent / download read — mirrors the backend where save persists
// to disk. Seed values come from SECTION_CONTENT when no override exists.
const sectionContentOverrides: Record<string, string> = {}

const sectionBody = (sectionId: string): string =>
  sectionContentOverrides[sectionId] ??
  SECTION_CONTENT[sectionId] ??
  `## ${SECTION_TITLE[sectionId] ?? sectionId}\n\n（示例正文）`

// Stable pseudo-version derived from the body bytes so a save -> re-read shows
// a changed version (clients use it as an optimistic-lock token). Matches the
// backend semantics of "sha256 of content".
const sectionVersion = (sectionId: string): string => {
  const body = sectionBody(sectionId)
  let h = 0
  for (let i = 0; i < body.length; i++) {
    h = (Math.imul(31, h) + body.charCodeAt(i)) | 0
  }
  return `v${(h >>> 0).toString(16)}`
}

const buildAudit = (withFidelity: boolean): AuditReport => ({
  verdict: withFidelity ? 'NEED_FIX' : 'NEED_FIX',
  summary: {
    total_issues: withFidelity ? 5 : 3,
    veto_issues: 0,
    high_issues: 1,
    scoring_coverage: '5/6',
  },
  checks: [
    {
      check: 'coverage',
      ok: false,
      issues: [
        {
          desc: '评分项 B1（投标报价）未在技术文件中覆盖，属报价分册范畴，可忽略',
          severity: 'medium',
        },
      ],
    },
    { check: 'numbers', ok: true, issues: [] },
    {
      check: 'checklist',
      ok: false,
      issues: [{ desc: '缺少 CMMI3 评估证书扫描件，请在素材中补充', severity: 'high' }],
    },
    { check: 'blind', ok: true, issues: [] },
    { check: 'outline_quality', ok: true, issues: [] },
    { check: 'placeholders', ok: true, issues: [] },
    ...(withFidelity
      ? [
          {
            check: 'source_fidelity',
            ok: false,
            issues: [{ desc: '第二章"等保三级已通过测评"结论缺少可溯源依据', severity: 'medium' }],
          },
          {
            check: 'endorsement_grounding',
            ok: false,
            issues: [{ desc: '第五章业绩金额"累计超 2 亿"未提供合同佐证', severity: 'medium' }],
          },
        ]
      : []),
  ],
})

// --- mutable in-memory store ---
interface MockProject extends BidProject {
  _parseAt?: number
  // Draft clock: `_draftAt` is the start of the running segment; `_draftElapsed`
  // carries elapsed time across a restart.
  _draftAt?: number | null
  _draftElapsed?: number
  _redraftAt?: Record<string, number>
  // Sections whose redraft already applied its visible rewrite (apply once).
  _redraftDone?: Record<string, boolean>
  outline?: OutlineDoc
  stage3Outline?: OutlineDoc
  coverage?: CoverageReport
  kb?: Record<string, unknown>
  quals?: Record<string, unknown>
  attachments?: AttachmentInfo[]
  briefsDoc?: BriefsDoc
  accepted?: Record<string, boolean>
  audit?: AuditReport
}

const iso = (daysAgo: number) => {
  const d = new Date('2026-07-03T09:00:00Z')
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

function seed(over: Partial<MockProject>): MockProject {
  return {
    id: 0,
    title: '标书项目',
    current_phase: 1,
    max_phase_reached: 1,
    status: 'created',
    created_at: iso(0),
    outline: MOCK_OUTLINE,
    coverage: MOCK_COVERAGE,
    kb: { bidder_knowledge_base: { company: '华信数智科技有限公司', established: '2012' } },
    quals: MOCK_TENDER.qualifications as Record<string, unknown>,
    attachments: [],
    accepted: {},
    audit: buildAudit(false),
    ...over,
  }
}

const store = new Map<number, MockProject>()
let nextId = 200
;[
  seed({
    id: 101,
    title: '智慧园区智能化建设项目投标书',
    current_phase: 6,
    max_phase_reached: 6,
    status: 'drafting',
    created_at: iso(1),
    attachments: [
      { name: '营业执照.pdf', size: 512000 },
      { name: 'ISO9001证书.pdf', size: 380000 },
    ],
  }),
  seed({
    id: 102,
    title: '市政务数据中心信息化采购项目',
    current_phase: 4,
    max_phase_reached: 4,
    status: 'drafting',
    created_at: iso(2),
  }),
  seed({
    id: 103,
    title: 'XX医院智慧医疗系统投标书',
    current_phase: 2,
    max_phase_reached: 2,
    status: 'parsed',
    created_at: iso(3),
  }),
  seed({
    id: 104,
    title: '城市轨道交通信号系统投标书',
    current_phase: 3,
    max_phase_reached: 3,
    status: 'parsed',
    created_at: iso(4),
  }),
  seed({
    id: 105,
    title: '（拆标失败示例）某采购项目',
    current_phase: 1,
    max_phase_reached: 1,
    status: 'parse_failed',
    created_at: iso(5),
  }),
  // Stage 4 (review) seed: drafting is complete, ready for read/refine.
  seed({
    id: 106,
    title: '区域医疗云平台建设项目',
    current_phase: 5,
    max_phase_reached: 5,
    status: 'review',
    created_at: iso(6),
    _draftAt: 0,
  }),
].forEach(p => store.set(p.id, p))

const snapshot = (p: MockProject): BidProject => ({
  id: p.id,
  title: p.title,
  current_phase: p.current_phase,
  max_phase_reached: p.max_phase_reached,
  status: p.status,
  model_name: p.model_name ?? '',
  created_at: p.created_at,
})

// Advance a project's parse state based on elapsed time (poll-driven).
function tickParse(p: MockProject) {
  if (p.status === 'parsing' && p._parseAt && Date.now() - p._parseAt > PARSE_MS) {
    p.status = 'parsed'
    p.current_phase = Math.max(p.current_phase, 2)
    p.max_phase_reached = Math.max(p.max_phase_reached, 2)
    if (!p.title || p.title === '标书项目') p.title = '智慧园区智能化建设项目投标书'
  }
}

// A section re-drafts for this long, then finishes with a rewritten body — so
// the editor + proposal diff visibly change (the old mock was a no-op, which is
// exactly why "重写没生效" reproduced under mock mode).
const REDRAFT_MS = 4000

function draftProgress(p: MockProject): DraftStatus {
  // Stamp the start on first observation so a directly-opened drafting project
  // streams from 0 rather than re-basing to "now" on every poll.
  if (p._draftAt === undefined) p._draftAt = Date.now()
  if (p._draftElapsed == null) p._draftElapsed = 0
  const running = p._draftAt != null
  const elapsed = p._draftElapsed + (running ? Date.now() - (p._draftAt as number) : 0)
  const doneCount = Math.min(SECTION_IDS.length, Math.floor(elapsed / DRAFT_PER_SECTION_MS))
  const sections: Record<string, string> = {}
  SECTION_IDS.forEach((id, i) => {
    sections[id] = i < doneCount ? 'done' : i === doneCount ? 'drafting' : 'pending'
  })
  // Overlay per-section redraft: a re-drafting section shows 'drafting' for
  // REDRAFT_MS, then flips to 'done' with a visibly rewritten body (applied once)
  // so getSectionContent returns changed content and the editor/diff update.
  const now = Date.now()
  for (const [sid, at] of Object.entries(p._redraftAt ?? {})) {
    if (now - at < REDRAFT_MS) {
      sections[sid] = 'drafting'
    } else {
      sections[sid] = 'done'
      if (!p._redraftDone?.[sid]) {
        sectionContentOverrides[sid] =
          `（AI 重写版）本节已根据重写指令优化表达。\n\n${sectionBody(sid)}`
        p._redraftDone = { ...(p._redraftDone ?? {}), [sid]: true }
      }
    }
  }
  const finished = doneCount >= SECTION_IDS.length
  return {
    total: SECTION_IDS.length,
    sections,
    finished,
    error: null,
  }
}

const need = (id: number): MockProject => {
  const p = store.get(id)
  if (!p) throw new Error(`mock: project ${id} not found`)
  return p
}

export const bidMockApis = {
  listModels: (): Promise<{ items: { name: string }[] }> =>
    delay({ items: [{ name: 'mock-model' }] }),
  createProject: (title: string, model_name?: string): Promise<BidProject> => {
    const p = seed({
      id: nextId++,
      title: title || '标书项目',
      current_phase: 1,
      status: 'created',
      model_name: model_name ?? '',
      created_at: new Date('2026-07-03T09:00:00Z').toISOString(),
    })
    store.set(p.id, p)
    return delay(snapshot(p))
  },
  listProjects: (): Promise<BidProject[]> => {
    for (const p of store.values()) tickParse(p)
    return delay(Array.from(store.values()).map(snapshot))
  },
  getProject: (id: number): Promise<BidProject> => {
    const p = need(id)
    tickParse(p)
    return delay(snapshot(p))
  },
  deleteProject: (id: number): Promise<{ status: string }> => {
    store.delete(id)
    return delay({ status: 'deleted' })
  },
  parse: (id: number): Promise<{ status: string }> => {
    const p = need(id)
    p.status = 'parsing'
    p._parseAt = Date.now()
    p.current_phase = 1
    return delay({ status: 'parsing' })
  },
  getParseStage: (id: number): Promise<{ stage: string }> => {
    const p = need(id)
    tickParse(p)
    if (p.status === 'parsing' && p._parseAt) {
      // Progress through the real backend stages over the mock parse window.
      const stages = ['segmenting', 'extracting', 'merging', 'building_outline']
      const frac = Math.min(0.999, (Date.now() - p._parseAt) / PARSE_MS)
      return delay({ stage: stages[Math.floor(frac * stages.length)] }, 120)
    }
    return delay({ stage: p.status === 'parse_failed' ? 'failed' : 'done' }, 120)
  },
  getTender: (id: number): Promise<{ tender: TenderDoc }> => {
    need(id)
    return delay({ tender: MOCK_TENDER })
  },
  buildOutline: (id: number): Promise<OutlineResponse> => {
    const p = need(id)
    p.outline = MOCK_OUTLINE
    p.coverage = MOCK_COVERAGE
    p.current_phase = Math.max(p.current_phase, 2)
    p.max_phase_reached = Math.max(p.max_phase_reached, 2)
    return delay({ outline: p.outline, coverage: p.coverage }, 800)
  },
  getOutline: (id: number): Promise<OutlineResponse> => {
    const p = need(id)
    return delay({ outline: p.outline ?? MOCK_OUTLINE, coverage: p.coverage ?? MOCK_COVERAGE })
  },
  saveOutline: (id: number, outline: OutlineDoc): Promise<OutlineResponse> => {
    const p = need(id)
    p.outline = outline
    return delay({ outline, coverage: p.coverage ?? MOCK_COVERAGE })
  },
  getOutlineStage3: (id: number): Promise<OutlineStage3Response> => {
    const p = need(id)
    const stage1 = p.outline ?? MOCK_OUTLINE
    // Lazily seed stage3 from the project outline (mirrors the backend copy).
    if (p.stage3Outline === undefined) p.stage3Outline = stage1
    const differs_from_stage1 = JSON.stringify(p.stage3Outline) !== JSON.stringify(stage1)
    return delay({ outline: p.stage3Outline, differs_from_stage1 })
  },
  saveOutlineStage3: (id: number, outline: OutlineDoc): Promise<OutlineStage3Response> => {
    const p = need(id)
    p.stage3Outline = outline
    const stage1 = p.outline ?? MOCK_OUTLINE
    return delay({
      outline,
      differs_from_stage1: JSON.stringify(outline) !== JSON.stringify(stage1),
    })
  },
  declarePackage: (): Promise<{ status: string }> => delay({ status: 'declared' }),
  getKnowledgeBase: (id: number): Promise<{ knowledge_base: Record<string, unknown> }> =>
    delay({ knowledge_base: need(id).kb ?? {} }),
  saveKnowledgeBase: (id: number, kb: Record<string, unknown>) => {
    need(id).kb = kb
    return delay({ knowledge_base: kb })
  },
  getQualifications: (id: number): Promise<{ qualifications: Record<string, unknown> }> =>
    delay({ qualifications: need(id).quals ?? {} }),
  saveQualifications: (id: number, q: Record<string, unknown>) => {
    need(id).quals = q
    return delay({ qualifications: q })
  },
  getLlmLog: (_id: number): Promise<{ items: LlmCall[] }> =>
    delay({
      items: [
        ['scoring', 4200, 820, '{"scoring": {"tech_items": [{"id": "T1", ...}]}}'],
        ['mandatory_clauses', 3100, 540, '{"mandatory_clauses": [{"id": "M1", "veto": true}]}'],
        ['project', 2600, 310, '{"project": {"name": "智慧园区智能化建设项目"}}'],
      ].map((row, i) => {
        const [label, pt, ct, response] = row as [string, number, number, string]
        return {
          id: i + 1,
          specialist: 'tender_sleuth',
          label,
          model: 'mock',
          prompt_tokens: pt,
          completion_tokens: ct,
          duration_ms: 8000 + i * 1500,
          status: 'ok',
          created_at: iso(0),
          request: `（抽取 ${label} 块的请求）`,
          response,
        }
      }),
    }),
  getBriefs: (id: number): Promise<BriefsDoc> =>
    delay(need(id).briefsDoc ?? { briefs: {}, materials: [] }),
  getGrounding: (_id: number): Promise<GroundingDoc> => delay(MOCK_GROUNDING),
  saveBriefs: (id: number, doc: BriefsDoc): Promise<BriefsDoc> => {
    need(id).briefsDoc = doc
    return delay(doc)
  },
  generateBriefs: (
    _id: number,
    nodeIds: string[]
  ): Promise<{ briefs: Record<string, NodeBrief> }> =>
    delay({
      briefs: Object.fromEntries(
        nodeIds.map(nid => [
          nid,
          {
            requirements: '由 LLM 生成的编写要点（mock）',
            emphasis: '差异化亮点（mock）',
            wordMin: '800',
            wordMax: '1500',
            needFigure: '否',
            importance: '中',
          } as NodeBrief,
        ])
      ),
    }),
  autoGenerateBriefs: (_id: number): Promise<{ status: string }> => delay({ status: 'generating' }),
  getBriefStatus: (
    _id: number
  ): Promise<{
    total: number
    nodes: Record<string, string>
    finished: boolean
    error: string | null
  }> => delay({ total: 0, nodes: {}, finished: true, error: null }),
  listAttachments: (id: number): Promise<{ items: AttachmentInfo[] }> =>
    delay({ items: need(id).attachments ?? [] }),
  uploadAttachment: (id: number, file: File): Promise<AttachmentInfo> => {
    const info = { name: file.name, size: file.size }
    const p = need(id)
    p.attachments = [...(p.attachments ?? []), info]
    return delay(info)
  },
  extractTenderText: async (file: File): Promise<ExtractedFile> => {
    // Mock mode reads the file client-side (no backend to extract docx/pdf).
    const text = await file.text()
    return delay({ name: file.name, size: file.size, text })
  },
  completeMaterials: (id: number): Promise<{ status: string }> => {
    const p = need(id)
    p.current_phase = Math.max(p.current_phase, 4)
    p.max_phase_reached = Math.max(p.max_phase_reached, 4)
    return delay({ status: 'materials_done' })
  },
  startDraft: (id: number): Promise<{ status: string }> => {
    const p = need(id)
    p.status = 'drafting'
    p._draftAt = Date.now()
    p._draftElapsed = 0
    p.current_phase = Math.max(p.current_phase, 4)
    return delay({ status: 'drafting' })
  },
  getDraftStatus: (id: number): Promise<DraftStatus> => delay(draftProgress(need(id)), 120),
  getDraftSections: (id: number): Promise<{ items: DraftSection[] }> => {
    const st = draftProgress(need(id))
    return delay({ items: SECTION_IDS.map(sid => ({ id: sid, status: st.sections[sid] })) })
  },
  getSectionContent: (
    id: number,
    sectionId: string
  ): Promise<{ id: string; content: string; version: string }> => {
    need(id)
    return delay({
      id: sectionId,
      content: sectionBody(sectionId),
      version: sectionVersion(sectionId),
    })
  },
  redraftSection: (id: number, sectionId: string): Promise<{ status: string }> => {
    const p = need(id)
    p._redraftAt = { ...(p._redraftAt ?? {}), [sectionId]: Date.now() }
    return delay({ status: 'drafting' }, 80)
  },
  redraftRange: (id: number, sectionId: string): Promise<{ status: string }> => {
    // Same as redraftSection: mark the section re-drafting so draftProgress
    // applies a visible rewrite. Without this the block-rewrite (bubble ↻ /
    // "扩写") was a no-op under mock mode — looking like it never ran.
    const p = need(id)
    p._redraftAt = { ...(p._redraftAt ?? {}), [sectionId]: Date.now() }
    return delay({ status: 'drafting' }, 80)
  },
  saveSection: (_id: number, sectionId: string, content: string): Promise<{ version: string }> => {
    // mock store: overwrite the section body and return its new version
    sectionContentOverrides[sectionId] = content
    return delay({ version: sectionVersion(sectionId) }, 80)
  },
  acceptSection: (id: number, sectionId: string): Promise<{ status: string }> => {
    const p = need(id)
    p.accepted = { ...(p.accepted ?? {}), [sectionId]: true }
    return delay({ status: 'accepted' })
  },
  getReviewStatus: (id: number): Promise<{ accepted: Record<string, boolean> }> =>
    delay({ accepted: need(id).accepted ?? {} }),
  completeReview: (id: number): Promise<{ status: string }> => {
    const p = need(id)
    p.current_phase = Math.max(p.current_phase, 6)
    p.max_phase_reached = Math.max(p.max_phase_reached, 6)
    return delay({ status: 'review_done' })
  },
  runAudit: (id: number): Promise<AuditReport> => {
    const p = need(id)
    p.audit = buildAudit(false)
    return delay(p.audit, 900)
  },
  getAuditReport: (id: number): Promise<AuditReport> => delay(need(id).audit ?? buildAudit(false)),
  verifyAudit: (id: number): Promise<AuditReport> => {
    const p = need(id)
    p.audit = buildAudit(true)
    return delay(p.audit, 1200)
  },
  finalize: (id: number): Promise<{ status: string }> => {
    const p = need(id)
    p.current_phase = 7
    p.max_phase_reached = 7
    p.status = 'done'
    return delay({ status: 'finalized' }, 900)
  },
  downloadBid: async (id: number): Promise<void> => {
    need(id)
    const blob = new Blob(
      [`投标文件（mock）— 项目 ${id}\n\n${SECTION_IDS.map(sid => sectionBody(sid)).join('\n\n')}`],
      {
        type: 'text/plain;charset=utf-8',
      }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '投标文件.txt'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}
