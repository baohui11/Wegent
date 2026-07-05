// SPDX-License-Identifier: Apache-2.0

import { bidApis } from '@/apis/bid'
import { apiClient } from '@/apis/client'

jest.mock('@/apis/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}))

describe('bidApis', () => {
  it('createProject posts to /bid/projects', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ id: 1, title: 'A' })
    const p = await bidApis.createProject('A')
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects', {
      title: 'A',
      model_name: '',
    })
    expect(p.id).toBe(1)
  })

  it('parse posts tender_text', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ status: 'parsed' })
    await bidApis.parse(3, '正文')
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/3/parse', {
      tender_text: '正文',
    })
  })

  it('getTender gets tender doc', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
    const r = await bidApis.getTender(3)
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/3/tender')
    expect(r.tender.scoring).toEqual([])
  })

  it('buildOutline posts to /outline', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({
      outline: { sections: [] },
      coverage: {},
    })
    await bidApis.buildOutline(5)
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/outline')
  })

  it('saveOutline puts outline', async () => {
    ;(apiClient.put as jest.Mock).mockResolvedValue({ outline: {}, coverage: {} })
    await bidApis.saveOutline(5, { sections: [] })
    expect(apiClient.put).toHaveBeenCalledWith('/bid/projects/5/outline', {
      outline: { sections: [] },
    })
  })

  it('declarePackage posts package', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ status: 'declared' })
    await bidApis.declarePackage(5, '包件二')
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/package', {
      package: '包件二',
    })
  })

  it('saveKnowledgeBase puts wrapped body', async () => {
    ;(apiClient.put as jest.Mock).mockResolvedValue({ knowledge_base: {} })
    await bidApis.saveKnowledgeBase(5, { bidder_knowledge_base: { a: 1 } })
    expect(apiClient.put).toHaveBeenCalledWith('/bid/projects/5/materials/knowledge-base', {
      knowledge_base: { bidder_knowledge_base: { a: 1 } },
    })
  })

  it('listAttachments gets items', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({ items: [{ name: 'a.pdf', size: 3 }] })
    const r = await bidApis.listAttachments(5)
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/5/materials/attachments')
    expect(r.items[0].name).toBe('a.pdf')
  })

  it('uploadAttachment posts multipart via fetch', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'a.pdf', size: 3 }),
    })
    ;(global as unknown as { fetch: jest.Mock }).fetch = fetchMock
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const info = await bidApis.uploadAttachment(5, file)
    expect(info).toEqual({ name: 'a.pdf', size: 3 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/bid/projects/5/materials/attachments')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('startDraft posts to /draft', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ status: 'drafting' })
    await bidApis.startDraft(5)
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/draft')
  })

  it('getDraftStatus gets status', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({
      total: 2,
      sections: { s1: 'done' },
      finished: false,
      error: null,
    })
    const s = await bidApis.getDraftStatus(5)
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/5/draft/status')
    expect(s.total).toBe(2)
  })

  it('getSectionContent gets a section', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({ id: 's1', content: '正文' })
    const r = await bidApis.getSectionContent(5, 's1')
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/5/sections/s1')
    expect(r.content).toBe('正文')
  })

  it('redraftSection posts instruction', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ status: 'drafting' })
    await bidApis.redraftSection(5, 's1', '更简洁')
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/sections/s1/redraft', {
      instruction: '更简洁',
    })
  })

  it('acceptSection posts', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ status: 'accepted' })
    await bidApis.acceptSection(5, 's1')
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/sections/s1/accept')
  })

  it('getReviewStatus gets accepted map', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({ accepted: { s1: true } })
    const r = await bidApis.getReviewStatus(5)
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/5/review/status')
    expect(r.accepted.s1).toBe(true)
  })

  it('runAudit posts to /audit', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({
      verdict: 'PASS',
      summary: {},
      checks: [],
    })
    await bidApis.runAudit(5)
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/audit')
  })

  it('getAuditReport gets /audit/report', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({
      verdict: 'NEED_FIX',
      summary: {},
      checks: [],
    })
    const r = await bidApis.getAuditReport(5)
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/5/audit/report')
    expect(r.verdict).toBe('NEED_FIX')
  })

  it('finalize posts to /finalize', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ status: 'finalized' })
    await bidApis.finalize(5)
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/finalize')
  })

  it('downloadBid fetches the docx blob and triggers an anchor download', async () => {
    const blob = new Blob(['PK'], { type: 'application/octet-stream' })
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    ;(global as unknown as { fetch: jest.Mock }).fetch = fetchMock
    const createURL = jest.fn().mockReturnValue('blob:x')
    const revokeURL = jest.fn()
    ;(global.URL as unknown as { createObjectURL: jest.Mock }).createObjectURL = createURL
    ;(global.URL as unknown as { revokeObjectURL: jest.Mock }).revokeObjectURL = revokeURL
    const click = jest.fn()
    const realCreate = document.createElement.bind(document)
    const spy = jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') (el as HTMLAnchorElement).click = click
      return el
    })
    await bidApis.downloadBid(7)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/bid/projects/7/download')
    expect(createURL).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalled()
    expect(revokeURL).toHaveBeenCalledWith('blob:x')
    spy.mockRestore()
  })

  it('verifyAudit posts to /audit/verify', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({
      verdict: 'NEED_FIX',
      summary: {},
      checks: [],
    })
    const r = await bidApis.verifyAudit(5)
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/audit/verify')
    expect(r.verdict).toBe('NEED_FIX')
  })

  it('getGrounding GETs the grounding endpoint', async () => {
    const doc = {
      items: { s1: { scoring: [{ id: 'T1', item: '方案' }], clauses: [] } },
    }
    ;(apiClient.get as jest.Mock).mockResolvedValueOnce(doc)
    const res = await bidApis.getGrounding(7)
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/7/grounding')
    expect(res.items.s1.scoring[0].id).toBe('T1')
  })

  it('generateBriefs POSTs to /materials/briefs/generate', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValueOnce({
      briefs: { s1: { requirements: 'AI要点', emphasis: 'AI亮点' } },
    })
    const res = await bidApis.generateBriefs(3, ['s1'])
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/3/materials/briefs/generate', {
      node_ids: ['s1'],
    })
    expect(res.briefs.s1.requirements).toBe('AI要点')
  })
})
